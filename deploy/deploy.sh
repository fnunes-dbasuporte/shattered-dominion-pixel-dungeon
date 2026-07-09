#!/usr/bin/env bash
#
# Deploy OFF-VM do Shattered Dominion (rodar na máquina de dev, Git Bash ok).
#
#   ./deploy/deploy.sh              build → envia → ativa release → health
#   ./deploy/deploy.sh --rollback   volta para a release anterior
#
# O que ele NÃO faz: mexer no nginx (passo manual — deploy/nginx-*.conf e
# docs/DEPLOY.md) e a primeira instalação (Node privado, .env, unit systemd
# — também no DEPLOY.md). Idempotente: re-rodar substitui a release do dia.
#
# Layout na VM:
#   /opt/shattered-dominion/{node/, .env, releases/<stamp>/{server.mjs,client/}, current -> releases/<stamp>}
#   /var/www/shattered-dominion/   (cópia do client da release ativa, dono www-data)

set -euo pipefail

SSH_HOST="${SSH_HOST:-lightsail}"
APP=shattered-dominion
OPT_DIR=/opt/$APP
WWW_DIR=/var/www/$APP
KEEP_RELEASES=5

ROOT="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
cd "$ROOT"

log() { printf '\n\033[1;36m== %s\033[0m\n' "$*"; }
die() { printf '\033[1;31mERRO: %s\033[0m\n' "$*" >&2; exit 1; }

# ── saúde: espera o serviço responder na VM ─────────────────────────
health_check() {
  log "health check (127.0.0.1:3005/health na VM)"
  for i in $(seq 1 10); do
    if ssh "$SSH_HOST" 'curl -fsS -m 3 http://127.0.0.1:3005/health' 2>/dev/null; then
      echo; echo "health OK"; return 0
    fi
    sleep 2
  done
  die "serviço não respondeu ao /health após 20s — veja: ssh $SSH_HOST 'journalctl -u $APP -n 50'"
}

# ── rollback: repõe a release anterior (server E client) ────────────
if [[ "${1:-}" == "--rollback" ]]; then
  log "rollback para a release anterior"
  # shellcheck disable=SC2016
  ssh "$SSH_HOST" bash -s <<REMOTE
set -euo pipefail
cd $OPT_DIR
atual=\$(readlink current | xargs basename)
# a mais nova ESTRITAMENTE anterior à ativa — rollbacks repetidos andam para trás
anterior=\$(ls -1 releases | sort | awk -v cur="\$atual" '\$0 < cur' | tail -1)
[[ -n "\$anterior" ]] || { echo "não há release anterior à \$atual"; exit 1; }
echo "ativa: \$atual → voltando para: \$anterior"
ln -sfn releases/\$anterior current
sudo rsync -a --delete current/client/ $WWW_DIR/
sudo chown -R www-data:www-data $WWW_DIR
sudo systemctl restart $APP
REMOTE
  health_check
  log "rollback concluído"
  exit 0
fi

# ── 1. pré-checagens na VM (primeira instalação é manual, ver DEPLOY.md) ──
log "pré-checagens na VM ($SSH_HOST)"
ssh "$SSH_HOST" bash -s <<REMOTE
set -euo pipefail
[[ -f $OPT_DIR/.env ]] || { echo "FALTA $OPT_DIR/.env (docs/DEPLOY.md §primeira instalação)"; exit 1; }
[[ -x $OPT_DIR/node/bin/node ]] || { echo "FALTA Node privado em $OPT_DIR/node (docs/DEPLOY.md)"; exit 1; }
[[ -f /etc/systemd/system/$APP.service ]] || { echo "FALTA a unit systemd (docs/DEPLOY.md)"; exit 1; }
livre=\$(free -m | awk '/^Mem:/ {print \$7}')
echo "RAM disponível: \${livre} MiB"
[[ \$livre -ge 150 ]] || echo "AVISO: menos de 150 MiB livres — confira os vizinhos antes de seguir"
REMOTE

# ── 2. build local ───────────────────────────────────────────────────
log "build de produção (local)"
pnpm build:prod
[[ -f packages/server/dist-prod/server.mjs ]] || die "bundle do servidor não gerado"
[[ -f packages/client/dist/index.html ]] || die "build do client não gerado"

# ── 3. empacota e envia ─────────────────────────────────────────────
STAMP=$(date +%Y%m%d-%H%M%S)
TMP_REMOTE=/tmp/$APP-deploy-$STAMP
log "empacotando e enviando (release $STAMP)"
tar -C packages/client/dist -czf /tmp/$APP-client.tgz .
tar -C packages/server/dist-prod -czf /tmp/$APP-server.tgz server.mjs
ssh "$SSH_HOST" "mkdir -p $TMP_REMOTE"
scp -q /tmp/$APP-client.tgz /tmp/$APP-server.tgz "$SSH_HOST:$TMP_REMOTE/"
rm -f /tmp/$APP-client.tgz /tmp/$APP-server.tgz

# ── 4. ativa a release na VM ────────────────────────────────────────
log "ativando release na VM"
ssh "$SSH_HOST" bash -s <<REMOTE
set -euo pipefail
cd $OPT_DIR
mkdir -p releases/$STAMP/client
tar -xzf $TMP_REMOTE/$APP-server.tgz -C releases/$STAMP/
tar -xzf $TMP_REMOTE/$APP-client.tgz -C releases/$STAMP/client/
rm -rf $TMP_REMOTE

ln -sfn releases/$STAMP current
sudo mkdir -p $WWW_DIR
sudo rsync -a --delete current/client/ $WWW_DIR/
sudo chown -R www-data:www-data $WWW_DIR
sudo systemctl restart $APP

# mantém só as $KEEP_RELEASES releases mais novas
cd releases && ls -1 | sort | head -n -$KEEP_RELEASES | xargs -r rm -rf
REMOTE

# ── 5. verificação ──────────────────────────────────────────────────
health_check
log "deploy $STAMP concluído — https://www.pixelforgegames.com.br/shattered-dominion/"
