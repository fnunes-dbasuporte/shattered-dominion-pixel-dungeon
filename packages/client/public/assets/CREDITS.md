# Créditos dos assets

Toda a pixel art deste diretório foi **gerada via [Pixellab](https://pixellab.ai)**
(API/MCP) especificamente para o Shattered Dominion Pixel Dungeon, e é
licenciada junto do projeto sob **GPL-3.0-or-later**.

Nenhum asset, nome ou texto foi copiado do Pixel Dungeon original de watabou —
o jogo é um clone de mecânicas com identidade visual própria.

## Inventário de geração

Os prompts exatos, IDs de job e URLs de origem de cada asset estão versionados
em `tools/assets/manifest.json`. Regeneração: `pnpm assets:gen --force`.

| Grupo      | Conteúdo                                                                                                                     | Origem                              |
| ---------- | ---------------------------------------------------------------------------------------------------------------------------- | ----------------------------------- |
| `tiles/`   | parede, 3 chãos, água, grama, brasas, porta, escadas (16×16)                                                                 | lote tiles-pro                      |
| `sprites/` | Guerreiro (idle/walk/attack/death ×4 direções, 8 cores), Rato, Gnoll, Caranguejo, Amálgama de Lodo — boss 60px (walk/attack) | personagens + templates de animação |
| `items/`   | armas, armaduras, 6 poções, pergaminho, ração, ouro, ankh/amuleto (32×32)                                                    | lote de objetos                     |
| `fx/`      | slash, poof, brilho de level up                                                                                              | lote de objetos                     |
| `ui/`      | painel de moldura (192×192, border-image)                                                                                    | ui-asset                            |

As 8 variações de cor do herói são recolor programático (re-matiz do pano
teal) feito por `tools/assets/compose.ts` — 1 geração, 8 saídas.

## Fonte

`fonts/silkscreen-{400,700}.woff2` — **Silkscreen**, de Jason Kottke
(<https://github.com/googlefonts/silkscreen>), sob **SIL Open Font License 1.1**.
A licença exige que acompanhe a fonte e está em `fonts/OFL.txt`.

Não é asset gerado: é fonte de terceiro, com licença própria — por isso fica
fora da cobertura GPL do resto deste diretório. Subconjunto latino (cobre todos
os acentos do português). Os glifos `▼ ▲ ◆ ✝` **não existem** nela; onde eram
usados, o jogo passou a desenhar formas em CSS ou a usar texto equivalente.
