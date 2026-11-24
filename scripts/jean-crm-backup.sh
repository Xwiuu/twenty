#!/usr/bin/env bash
# Backup do Jean CRM: banco (pg_dump) + arquivos persistentes. Rode no servidor, de qualquer pasta.
# Variáveis opcionais: BACKUP_DIR (padrão /var/backups/jean-crm), KEEP_DAYS (padrão 14).
# Só termina com sucesso (e só deixa arquivos finais) se banco E arquivos foram gerados e verificados.
set -euo pipefail

cd "$(dirname "$0")/../infra/jean-crm"
BACKUP_DIR="${BACKUP_DIR:-/var/backups/jean-crm}"
KEEP_DAYS="${KEEP_DAYS:-14}"
# Pasta dos arquivos dentro do contêiner (volume server-local-data). Só mude em testes.
FILES_ROOT="${JEAN_FILES_ROOT:-/app/packages/twenty-server}"
umask 077
mkdir -p "$BACKUP_DIR"
stamp="$(date +%Y%m%d-%H%M%S)"
db_final="$BACKUP_DIR/db-$stamp.dump"
files_final="$BACKUP_DIR/files-$stamp.tar.gz"
db_tmp="$db_final.partial"
files_tmp="$files_final.partial"

# Qualquer falha remove os parciais; nada incompleto vira "backup".
trap 'rm -f "$db_tmp" "$files_tmp"' EXIT

docker compose exec -T db pg_dump -U postgres -d default -Fc >"$db_tmp"
[ -s "$db_tmp" ] || { echo "ERRO: dump do banco vazio." >&2; exit 1; }
docker compose exec -T db pg_restore --list <"$db_tmp" >/dev/null ||
  { echo "ERRO: dump do banco ilegível pelo pg_restore." >&2; exit 1; }

# Contêiner temporário com o mesmo volume: não depende do servidor estar rodando.
docker compose run --rm --no-deps -T --entrypoint tar server czf - -C "$FILES_ROOT" .local-storage >"$files_tmp"
[ -s "$files_tmp" ] || { echo "ERRO: arquivo de anexos vazio." >&2; exit 1; }
gzip -t "$files_tmp" || { echo "ERRO: .tar.gz corrompido." >&2; exit 1; }
listing="$(tar tzf "$files_tmp")" || { echo "ERRO: .tar.gz ilegível." >&2; exit 1; }
# O tar daqui retorna sucesso até para TAR truncado; um TAR completo termina com blocos zerados.
[ "$(gzip -dc "$files_tmp" | tail -c 1024 | tr -d '\0' | wc -c)" -eq 0 ] ||
  { echo "ERRO: .tar.gz truncado (sem marcador de fim)." >&2; exit 1; }
grep -q '^\(\./\)\?\.local-storage/\?$' <<<"$listing" ||
  { echo "ERRO: .local-storage ausente no .tar.gz." >&2; exit 1; }

mv "$db_tmp" "$db_final"
mv "$files_tmp" "$files_final"

find "$BACKUP_DIR" -maxdepth 1 -type f \( -name 'db-*.dump' -o -name 'files-*.tar.gz' \) -mtime +"$KEEP_DAYS" -delete
echo "Backup concluído e verificado: $db_final e $files_final"
