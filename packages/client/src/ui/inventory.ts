import type { InventoryEntry, YouState } from "@shattered-dominion/shared";
import { INVENTORY_SLOTS } from "@shattered-dominion/shared";
import type { GameConnection } from "../net/connection.js";

const GLYPHS: Record<string, string> = {
  weapon: "†",
  armor: "▣",
  potion: "!",
  scroll: "?",
  food: "%",
};

const ACTION_LABEL: Record<string, string> = {
  weapon: "Equipar",
  armor: "Equipar",
  potion: "Beber",
  scroll: "Ler",
  food: "Comer",
};

function escapeHtml(s: string): string {
  return s.replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;");
}

/**
 * Painel de inventário em DOM sobre o canvas (grade 4×4). O clique só envia
 * a intenção — toda validação é do servidor. O pergaminho de identificação
 * usa modo de seleção: lê → escolhe o alvo → envia use com targetUid.
 */
export class InventoryPanel {
  private readonly root: HTMLDivElement;
  /** uid do pergaminho de identificação aguardando escolha do alvo. */
  private identifySource: string | null = null;
  private lastYou: YouState | null = null;

  constructor(private readonly conn: GameConnection) {
    this.root = document.createElement("div");
    this.root.id = "inv";
    this.root.style.display = "none";
    document.body.appendChild(this.root);
  }

  get isOpen(): boolean {
    return this.root.style.display !== "none";
  }

  toggle(): void {
    if (this.isOpen) this.close();
    else this.open();
  }

  open(): void {
    this.root.style.display = "flex";
    this.render();
  }

  close(): void {
    this.root.style.display = "none";
    this.identifySource = null;
  }

  update(you: YouState): void {
    this.lastYou = you;
    if (this.isOpen) this.render();
  }

  private render(): void {
    const inv = this.lastYou?.inventory ?? [];
    const gold = this.lastYou?.gold ?? 0;
    const head = this.identifySource
      ? "escolha o item a identificar (Esc cancela)"
      : `Inventário ${inv.length}/${INVENTORY_SLOTS} · ${gold} de ouro`;

    let html = `<div class="inv-card"><div class="inv-head">${head}</div><div class="inv-grid">`;
    for (let slot = 0; slot < INVENTORY_SLOTS; slot++) {
      const item = inv[slot];
      if (!item) {
        html += `<div class="inv-slot vazio"></div>`;
        continue;
      }
      html += `<div class="inv-slot${this.identifySource ? " alvo" : ""}" data-slot-uid="${item.uid}">
        <div class="inv-glyph cat-${item.category}">${GLYPHS[item.category] ?? "•"}</div>
        <div class="inv-label">${escapeHtml(item.label)}${item.equipped ? ' <span class="equipado">[E]</span>' : ""}</div>
        ${this.identifySource ? "" : this.actionsFor(item)}
      </div>`;
    }
    html += `</div><div class="inv-hint">I abre/fecha · Esc fecha</div></div>`;
    this.root.innerHTML = html;
    this.wire();
  }

  private actionsFor(item: InventoryEntry): string {
    const principal =
      item.category === "weapon" || item.category === "armor"
        ? item.equipped
          ? "Remover"
          : "Equipar"
        : (ACTION_LABEL[item.category] ?? "Usar");
    return `<div class="inv-actions">
      <button data-action="principal" data-uid="${item.uid}">${principal}</button>
      <button data-action="drop" data-uid="${item.uid}" class="secundario">Dropar</button>
    </div>`;
  }

  private wire(): void {
    if (this.identifySource) {
      // modo seleção: clicar num slot identifica-o
      this.root.querySelectorAll<HTMLElement>("[data-slot-uid]").forEach((el) => {
        el.addEventListener("click", () => {
          const alvo = el.dataset.slotUid!;
          if (alvo !== this.identifySource) {
            this.conn.sendUse(this.identifySource!, alvo);
          }
          this.identifySource = null;
          this.render();
        });
      });
      return;
    }

    this.root.querySelectorAll<HTMLButtonElement>("[data-action]").forEach((btn) => {
      btn.addEventListener("click", (ev) => {
        ev.stopPropagation();
        const uid = btn.dataset.uid!;
        const item = this.lastYou?.inventory.find((i) => i.uid === uid);
        if (!item) return;

        if (btn.dataset.action === "drop") {
          this.conn.sendDrop(uid);
          return;
        }
        if (item.category === "weapon" || item.category === "armor") {
          this.conn.sendEquip(uid);
        } else if (
          item.category === "scroll" &&
          item.identified &&
          item.label.includes("Identificação")
        ) {
          this.identifySource = uid;
          this.render();
        } else {
          this.conn.sendUse(uid);
        }
      });
    });
  }
}
