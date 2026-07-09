import { CHAT_MAX_LENGTH } from "@shattered-dominion/shared";

/**
 * Caixa de chat em DOM (Enter abre → Enter envia → Esc fecha).
 * Enquanto aberta, o teclado do Phaser fica desativado via onToggle,
 * para digitar "i"/"w" sem abrir inventário nem andar.
 */
export class ChatBox {
  private readonly wrap: HTMLDivElement;
  private readonly input: HTMLInputElement;
  isOpen = false;

  constructor(
    onSend: (text: string) => void,
    private readonly onToggle: (open: boolean) => void,
  ) {
    this.wrap = document.createElement("div");
    this.wrap.id = "chat";
    this.wrap.style.display = "none";

    this.input = document.createElement("input");
    this.input.maxLength = CHAT_MAX_LENGTH;
    this.input.placeholder = "diga algo... (Enter envia · Esc fecha)";
    this.input.autocomplete = "off";
    this.wrap.appendChild(this.input);
    document.body.appendChild(this.wrap);

    this.input.addEventListener("keydown", (ev) => {
      ev.stopPropagation();
      if (ev.key === "Enter") {
        const text = this.input.value.trim();
        if (text.length > 0) onSend(text);
        this.close();
      } else if (ev.key === "Escape") {
        this.close();
      }
    });
    // clicar fora fecha sem enviar
    this.wrap.addEventListener("mousedown", (ev) => {
      if (ev.target === this.wrap) this.close();
    });
  }

  open(): void {
    if (this.isOpen) return;
    this.isOpen = true;
    this.wrap.style.display = "flex";
    this.input.value = "";
    this.onToggle(true);
    // foco após o evento atual, senão o Enter que abriu vaza para o input
    setTimeout(() => this.input.focus(), 0);
  }

  close(): void {
    if (!this.isOpen) return;
    this.isOpen = false;
    this.wrap.style.display = "none";
    this.input.blur();
    this.onToggle(false);
  }
}
