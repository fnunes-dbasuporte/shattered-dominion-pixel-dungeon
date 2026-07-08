# Shattered Dominion Pixel Dungeon

Roguelike multiplayer cooperativo (até **8 jogadores**) para navegador, inspirado nas _mecânicas_ do
[Pixel Dungeon](https://pixeldungeon.watabou.ru/) de watabou. Explore a masmorra em tempo real com
seus amigos: o mundo anda sozinho, mas cada ação tem custo de tempo como num roguelike clássico.

> **English summary:** Shattered Dominion Pixel Dungeon is a browser-based co-op multiplayer
> roguelike (up to 8 players) inspired by the _mechanics_ of watabou's Pixel Dungeon. Real-time
> with server ticks, authoritative Node.js server, Phaser 4 client. It is a mechanics clone only —
> it contains **no code, assets, names or text** from the original game. Licensed GPL-3.0-or-later.

## Stack

| Camada        | Tecnologia                                                                                  |
| ------------- | ------------------------------------------------------------------------------------------- |
| Cliente       | [Phaser 4](https://phaser.io/) + TypeScript + Vite                                          |
| Servidor      | Node.js 22+ + [Colyseus](https://colyseus.io/) (100% autoritativo, 10 ticks/s)              |
| Compartilhado | `packages/shared` — lógica de jogo determinística (RNG seedado, geração de dungeon, regras) |
| Monorepo      | pnpm workspaces                                                                             |

```
[Cliente Phaser 4] ⇄ WebSocket (Colyseus) ⇄ [Servidor Node 22]
        └──────────── packages/shared ────────────┘
```

O servidor valida toda intenção do jogador e propaga apenas o estado visível (fog of war
anti-cheat). O cliente só renderiza, interpola e captura input — nenhuma regra de jogo roda nele.

## Como rodar

Requisitos: Node.js ≥ 22 e [pnpm](https://pnpm.io/) ≥ 10.

```bash
pnpm install
pnpm dev        # sobe servidor (ws://localhost:2567) e cliente (http://localhost:5173)
```

Outros comandos:

```bash
pnpm test       # testes unitários (vitest)
pnpm build      # build de produção de todos os pacotes
pnpm lint       # eslint + prettier
```

Abra `http://localhost:5173` em uma ou mais abas para entrar na mesma sala (máx. 8 jogadores).

## Licença e créditos

- Código sob **GPL-3.0-or-later** — veja [LICENSE](./LICENSE).
- Inspirado nas mecânicas do **Pixel Dungeon**, criado por [watabou](https://pixeldungeon.watabou.ru/)
  (GPL-3.0). Este projeto é um clone de mecânicas: **não contém código, assets, nomes nem textos do
  jogo original**. Toda a arte é gerada para este projeto.
- Obrigado a watabou pelo jogo que inspirou este projeto. ❤️
