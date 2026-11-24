#!/usr/bin/env bash
# Restaura o Jean CRM a partir de um par de backups gerado por jean-crm-backup.sh.
# Uso: scripts/jean-crm-restore.sh <db-*.dump> <files-*.tar.gz> --yes
#
# Segurança: valida os dois arquivos ANTES de parar qualquer coisa; restaura o banco em um banco novo e
# só então troca (o banco atual vira default_old_<data>, não é apagado); os arquivos atuais vão para
# .local-storage/.pre-restore-<data> (não são apagados). Nenhum volume é removido.
set -euo pipefail

if [ "$#" -ne 3 ] || [ "$3" != "--yes" ]; then
  echo "Uso: $0 <db-*.dump> <files-*.tar.gz> --yes" >&2
  echo "Isto troca o banco e os anexos atuais pelos do backup. Confirme com --yes." >&2
  exit 2
fi
db_dump="$(realpath "$1")"
files_archive="$(realpath "$2")"
cd "$(dirname "$0")/../infra/jean-crm"
FILES_ROOT="${JEAN_FILES_ROOT:-/app/packages/twenty-server}"
stamp="$(date +%Y%m%d-%H%M%S)"
new_db="default_restore_$stamp"
old_db="default_old_$stamp"
psql_db() { docker compose exec -T db psql -U postgres -v ON_ERROR_STOP=1 "$@"; }

echo "1/6 Validando os backups (nada foi alterado ainda)..."
[ -s "$db_dump" ] && [ -s "$files_archive" ] || { echo "ERRO: backup vazio ou inexistente." >&2; exit 1; }
docker compose up -d --wait db
docker compose exec -T db pg_restore --list <"$db_dump" >/dev/null || { echo "ERRO: dump ilegível." >&2; exit 1; }
gzip -t "$files_archive" || { echo "ERRO: .tar.gz corrompido." >&2; exit 1; }
archive_files="$(tar tzf "$files_archive" | sed 's#^\./##' | grep -v '/$' | sort || true)"

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
[ "$workspaces" -ge 1 ] || { echo "ERRO: backup sem workspace; troca cancelada." >&2; exit 1; }
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
restored_files="$(docker compose exec -T server sh -c "cd '$FILES_ROOT' && find .local-storage -path '.local-storage/.pre-restore-*' -prune -o -type f -print" | sort)"
[ "$restored_files" = "$archive_files" ] ||
  { echo "ERRO: a lista de arquivos restaurados difere do backup." >&2; exit 1; }
echo "    serviços saudáveis; banco com $workspaces workspace(s); $(grep -c . <<<"$archive_files") arquivo(s) idênticos em nome ao backup."
echo "Restauração concluída. Depois de conferir o CRM, o operador pode remover manualmente:"
echo "  banco anterior:   docker compose exec db psql -U postgres -c 'drop database \"$old_db\"'"
echo "  arquivos antigos: docker compose run --rm --no-deps --entrypoint rm server -rf $FILES_ROOT/.local-storage/.pre-restore-$stamp"
