#!/usr/bin/env bash
# Backup do Jean CRM: banco (pg_dump) + arquivos persistentes. Rode a partir de qualquer pasta, no servidor.
# Variáveis opcionais: BACKUP_DIR (padrão /var/backups/jean-crm), KEEP_DAYS (padrão 14).
set -euo pipefail

cd "$(dirname "$0")/../infra/jean-crm"
BACKUP_DIR="${BACKUP_DIR:-/var/backups/jean-crm}"
KEEP_DAYS="${KEEP_DAYS:-14}"
umask 077
mkdir -p "$BACKUP_DIR"
stamp="$(date +%Y%m%d-%H%M%S)"

docker compose exec -T db pg_dump -U postgres -d default -Fc >"$BACKUP_DIR/db-$stamp.dump.partial"
# Só vale como backup se o arquivo for legível pelo pg_restore.
docker compose exec -T db pg_restore --list <"$BACKUP_DIR/db-$stamp.dump.partial" >/dev/null
mv "$BACKUP_DIR/db-$stamp.dump.partial" "$BACKUP_DIR/db-$stamp.dump"

docker compose exec -T server tar czf - -C /app/packages/twenty-server .local-storage >"$BACKUP_DIR/files-$stamp.tar.gz"

find "$BACKUP_DIR" -maxdepth 1 -type f \( -name 'db-*.dump' -o -name 'files-*.tar.gz' \) -mtime +"$KEEP_DAYS" -delete
echo "Backup concluído: $BACKUP_DIR/db-$stamp.dump e files-$stamp.tar.gz"
