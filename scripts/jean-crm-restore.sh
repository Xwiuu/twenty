#!/usr/bin/env bash
# Restaura o Jean CRM a partir de um par de backups gerado por jean-crm-backup.sh.
# Uso: scripts/jean-crm-restore.sh <db-*.dump> <files-*.tar.gz> --yes
#
# Segurança: valida os dois arquivos ANTES de parar qualquer coisa (inclusive lendo o TAR inteiro);
# restaura o banco em um banco novo e só então troca (o banco atual vira default_old_<data>, não é
# apagado); os arquivos atuais vão para .local-storage/.pre-restore-<data> (não são apagados).
# Nenhum volume é removido. No fim, compara o SHA-256 de cada arquivo restaurado com o do backup.
set -euo pipefail

FILES_ROOT="${JEAN_FILES_ROOT:-/app/packages/twenty-server}"

die() { echo "ERRO: $*" >&2; exit 1; }
psql_db() { docker compose exec -T db psql -U postgres -v ON_ERROR_STOP=1 "$@"; }

# SHA-256 de cada arquivo do .tar.gz (extraído em diretório temporário), ordenado. Falha se o TAR não extrair.
archive_manifest() {
  local dir rc=0
  dir="$(mktemp -d)"
  if tar xzf "$1" -C "$dir"; then
    (cd "$dir" && find .local-storage -path '.local-storage/.pre-restore-*' -prune -o -type f -print0 |
      LC_ALL=C sort -z | xargs -0 -r sha256sum) || rc=$?
  else
    rc=$?
  fi
  rm -rf "$dir"
  return "$rc"
}

# SHA-256 de cada arquivo do volume (lido por dentro do contêiner do servidor), mesmo formato e ordem.
volume_manifest() {
  docker compose exec -T server sh -c "cd '$FILES_ROOT' && find .local-storage -path '.local-storage/.pre-restore-*' -prune -o -type f -print0 | LC_ALL=C sort -z | xargs -0 -r sha256sum"
}

# Valida o .tar.gz sem alterar nada. Nenhum erro é mascarado.
# Atenção: o `tar` daqui retorna sucesso até para lixo ou TAR truncado, então o código de saída não basta.
# Um TAR completo termina com blocos zerados (>= 1024 bytes); sem isso ele está truncado/não é TAR.
validate_archive() {
  local listing trailer_bytes
  gzip -t "$1" || die ".tar.gz corrompido (gzip)."
  listing="$(tar tzf "$1")" || die "conteúdo do .tar.gz não é um TAR válido."
  trailer_bytes="$(gzip -dc "$1" | tail -c 1024 | tr -d '\0' | wc -c)" || die "falha ao ler o fim do .tar.gz."
  [ "$trailer_bytes" -eq 0 ] || die "TAR truncado ou inválido (sem o marcador de fim de arquivo)."
  grep -q '^\(\./\)\?\.local-storage/\?$' <<<"$listing" || die ".local-storage ausente no .tar.gz."
}

main() {
  if [ "$#" -ne 3 ] || [ "$3" != "--yes" ]; then
    echo "Uso: $0 <db-*.dump> <files-*.tar.gz> --yes" >&2
    echo "Isto troca o banco e os anexos atuais pelos do backup. Confirme com --yes." >&2
    exit 2
  fi
  local db_dump files_archive stamp new_db old_db workspaces archive_sums restored_sums
  db_dump="$(realpath "$1")"
  files_archive="$(realpath "$2")"
  cd "$(dirname "${BASH_SOURCE[0]}")/../infra/jean-crm"
  stamp="$(date +%Y%m%d-%H%M%S)"
  new_db="default_restore_$stamp"
  old_db="default_old_$stamp"

  echo "1/6 Validando os backups (nada foi alterado ainda)..."
  [ -s "$db_dump" ] && [ -s "$files_archive" ] || die "backup vazio ou inexistente."
  docker compose up -d --wait db
  docker compose exec -T db pg_restore --list <"$db_dump" >/dev/null || die "dump ilegível."
  validate_archive "$files_archive"
  archive_sums="$(archive_manifest "$files_archive")" || die "não foi possível extrair o .tar.gz para conferência."

  echo "2/6 Parando aplicação (server, worker, caddy)..."
  docker compose stop caddy worker server

  echo "3/6 Restaurando o banco em $new_db..."
  psql_db -c "create database \"$new_db\""
  if ! docker compose exec -T db pg_restore -U postgres -d "$new_db" --no-owner --exit-on-error <"$db_dump"; then
    echo "ERRO ao restaurar o banco. O banco atual NÃO foi alterado; a aplicação continua parada." >&2
    echo "Remova o banco parcial: docker compose exec db psql -U postgres -c 'drop database \"$new_db\"'" >&2
    exit 1
  fi
  workspaces="$(psql_db -d "$new_db" -tAc 'select count(*) from core.workspace')"
  [ "$workspaces" -ge 1 ] || die "backup sem workspace; troca cancelada."
  psql_db -c "select pg_terminate_backend(pid) from pg_stat_activity where datname = 'default' and pid <> pg_backend_pid()" >/dev/null
  psql_db -c "alter database \"default\" rename to \"$old_db\""
  psql_db -c "alter database \"$new_db\" rename to \"default\""
  echo "    banco anterior preservado como $old_db"

  echo "4/6 Restaurando os arquivos (contêiner temporário, servidor parado)..."
  docker compose run --rm --no-deps -T --entrypoint sh server -c '
    set -eu
    dir="$1/.local-storage"; keep="$dir/.pre-restore-$2"
    mkdir -p "$keep"
    find "$dir" -mindepth 1 -maxdepth 1 ! -name ".pre-restore-*" -exec mv {} "$keep"/ \;
  ' sh "$FILES_ROOT" "$stamp"
  docker compose run --rm --no-deps -T --entrypoint tar server xzf - -C "$FILES_ROOT" <"$files_archive"

  echo "5/6 Iniciando os serviços..."
  docker compose up -d --wait

  echo "6/6 Validando..."
  workspaces="$(psql_db -d default -tAc 'select count(*) from core.workspace')"
  restored_sums="$(volume_manifest)"
  [ "$restored_sums" = "$archive_sums" ] ||
    die "o conteúdo restaurado difere do backup (nome ou SHA-256). Banco anterior: $old_db; arquivos anteriores: .local-storage/.pre-restore-$stamp."
  echo "    serviços saudáveis; banco com $workspaces workspace(s); $(printf '%s' "$archive_sums" | awk 'END { print NR }') arquivo(s) com SHA-256 idêntico ao do backup."
  echo "Restauração concluída. Depois de conferir o CRM, o operador pode remover manualmente:"
  echo "  banco anterior:   docker compose exec db psql -U postgres -c 'drop database \"$old_db\"'"
  echo "  arquivos antigos: docker compose run --rm --no-deps --entrypoint rm server -rf $FILES_ROOT/.local-storage/.pre-restore-$stamp"
}

# Permite carregar as funções em testes (source) sem executar a restauração.
if [ "${BASH_SOURCE[0]}" = "$0" ]; then main "$@"; fi
