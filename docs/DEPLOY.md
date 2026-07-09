# Deploy em produção

Guia operacional do deploy na VM (Lightsail, Debian 12, **nginx e recursos
compartilhados com outros apps** — a RAM é o gargalo). Detalhes sensíveis da
infra (IP, mapa de portas dos vizinhos, recon completo) vivem em
`docs/infra/INFRA-VM-*.md`, **locais e fora do git** — leia-os antes de
qualquer operação.

Modelo: **build sempre fora da VM**; na VM roda só `node` (bundle único)
via systemd + arquivos estáticos atrás do nginx.

| Item          | Valor                                                       |
| ------------- | ----------------------------------------------------------- |
| URL pública   | `https://www.pixelforgegames.com.br/shattered-dominion/`    |
| WebSocket     | `wss://www.pixelforgegames.com.br/shattered-dominion-ws/`   |
| Porta interna | `3005`, bind **sempre** `127.0.0.1` (só o nginx expõe)      |
| Serviço       | `shattered-dominion` (systemd, `MemoryMax=400M`)            |
| Estático      | `/var/www/shattered-dominion/`                              |
| App           | `/opt/shattered-dominion/` (releases + symlink `current`)   |
| Node          | **privado** em `/opt/shattered-dominion/node` (Node 22 LTS) |

## 0. Recon prévio — obrigatório antes de instalar ou atualizar

O estado da VM é volátil e compartilhado. Rode o recon completo documentado
em `docs/infra/INFRA-VM-pixelforge.md` e confirme:

```bash
ssh lightsail 'free -h; echo ---; sudo ss -ltnp | grep -E "3005|nginx"'
```

- [ ] **Porta 3005 continua livre** (ou é o NOSSO serviço que está nela)
- [ ] **RAM disponível ≥ 150 MiB** (coluna `available` do `free -h`); se a
      box estiver sob pressão, resolva com o dono dos vizinhos antes
- [ ] Nada mudou no nginx que afete os prefixos `/shattered-dominion*`

## 1. Primeira instalação (uma vez, manual)

### 1.1 Node 22 privado do app

O node do sistema pertence aos outros apps — **não atualizar o global**.

```bash
ssh lightsail
sudo mkdir -p /opt/shattered-dominion
cd /tmp && curl -fsSLO https://nodejs.org/dist/v22.21.0/node-v22.21.0-linux-x64.tar.xz
sudo tar -xJf node-v22.21.0-linux-x64.tar.xz -C /opt/shattered-dominion
sudo mv /opt/shattered-dominion/node-v22.21.0-linux-x64 /opt/shattered-dominion/node
/opt/shattered-dominion/node/bin/node --version   # v22.x
```

### 1.2 Estrutura, .env e permissões

```bash
sudo mkdir -p /opt/shattered-dominion/releases /var/www/shattered-dominion
sudo chown -R admin:admin /opt/shattered-dominion
# copie deploy/.env.example para /opt/shattered-dominion/.env e revise
install -m 600 /dev/stdin /opt/shattered-dominion/.env   # cole o conteúdo
```

### 1.3 Unit systemd

Na máquina de dev: `scp deploy/shattered-dominion.service lightsail:/tmp/`. Na VM:

```bash
sudo cp /tmp/shattered-dominion.service /etc/systemd/system/
sudo systemctl daemon-reload
sudo systemctl enable shattered-dominion   # o start fica para o 1º deploy
```

### 1.4 Primeiro deploy (da máquina de dev)

```bash
./deploy/deploy.sh
```

O script valida os pré-requisitos acima, faz o build, envia a release,
ativa e espera o `/health`. Sem release ainda? O restart falha até o
primeiro rsync terminar — o próprio script cuida da ordem.

### 1.5 nginx (manual, com backup — NUNCA restart)

O nginx é compartilhado. Protocolo completo no topo de
`deploy/nginx-shattered-dominion.conf`:

```bash
ssh lightsail
sudo cp /etc/nginx/conf.d/default.conf /etc/nginx/conf.d/default.conf.bak-$(date +%F)
sudoedit /etc/nginx/conf.d/default.conf   # colar os 3 locations do snippet no server block do www
sudo nginx -t && sudo systemctl reload nginx
```

Depois do reload, **teste 1 URL de cada app vizinho** (lista nos docs de
infra locais) para confirmar que nada quebrou.

## 2. Atualização (rotina)

```bash
./deploy/deploy.sh
```

Idempotente: gera release nova em `releases/<stamp>`, ativa via symlink,
rsync do estático, restart, health check. Mantém as 5 últimas releases.
Runs são efêmeras — restart derruba as partidas em andamento; avise os
jogadores se houver gente online.

## 3. Rollback

```bash
./deploy/deploy.sh --rollback
```

Volta servidor **e** cliente para a release estritamente anterior à ativa
(repetível: cada chamada anda uma release para trás), restart + health.

## 4. Verificações

```bash
# na VM
curl -fsS http://127.0.0.1:3005/health          # {"status":"ok",...}
systemctl status shattered-dominion             # active (running)
systemctl show shattered-dominion -p MemoryCurrent   # < 300 MB esperado
journalctl -u shattered-dominion -n 50          # logs recentes
free -h                                          # RAM da box sob controle

# de fora
curl -fsSI https://www.pixelforgegames.com.br/shattered-dominion/   # 200, HTTPS válido
# jogo: abrir a URL, criar sala, jogar de fora da rede local (wss via proxy)
```

## 5. Incidentes

- **Serviço reiniciando em loop**: `journalctl -u shattered-dominion -e`;
  cheque o `.env` (PORT/BIND_ADDR) e conflito de porta (`sudo ss -ltnp | grep 3005`).
- **OOM**: `MemoryMax=400M` mata só o nosso processo; o `Restart=always`
  recomeça limpo. Se recorrente, investigue quantidade de salas/jogadores
  antes de pensar em subir o limite — a caixa não tem folga.
- **wss não conecta mas o health local responde**: nginx — confira os
  headers `Upgrade/Connection` do snippet e `sudo nginx -t`.
- **Nginx quebrado após edição**: restaure o backup
  `default.conf.bak-<data>` + `sudo nginx -t && sudo systemctl reload nginx`.

## 6. Banco de dados

A v1.0 **não usa banco** (runs efêmeras). Os DBs `shattered_dominion` e
`shattered_dominion_test` (role `shattered_app`) já existem no Postgres da
VM e ficam **reservados para a expansão** (contas/persistência) — não
remover nem reutilizar.
