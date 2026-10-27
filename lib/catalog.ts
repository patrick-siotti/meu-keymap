import type { Action } from "./model.ts";
import { MEDIA } from "./legacy-model.ts";
import { SHORTCUT_SOURCES, WINDOWS_SHORTCUT_GROUPS } from "./windows-shortcuts.ts";
export interface CatalogItem {
  id: string;
  category: string;
  title: string;
  description: string;
  action: Action;
  context?: string;
  source?: string;
}
const shortcuts = [
  ["Edição", "Copiar", "Copia o conteúdo selecionado.", "Ctrl+C"],
  ["Edição", "Colar", "Cola o conteúdo da área de transferência.", "Ctrl+V"],
  ["Edição", "Recortar", "Recorta o conteúdo selecionado.", "Ctrl+X"],
  ["Edição", "Desfazer", "Desfaz a última alteração.", "Ctrl+Z"],
  [
    "Edição",
    "Refazer",
    "Atalho comum; pode variar entre aplicativos.",
    "Ctrl+Y",
  ],
  ["Edição", "Salvar", "Salva o documento atual.", "Ctrl+S"],
  ["Edição", "Selecionar tudo", "Seleciona todo o conteúdo.", "Ctrl+A"],
  ["Edição", "Pesquisar", "Abre a busca no aplicativo atual.", "Ctrl+F"],
  ["Edição", "Imprimir", "Abre as opções de impressão.", "Ctrl+P"],
  ["Edição", "Negrito", "Alterna negrito em editores compatíveis.", "Ctrl+B"],
  [
    "Windows",
    "Captura de tela",
    "Abre o recorte de tela do Windows.",
    "Win+Shift+S",
  ],
  [
    "Windows",
    "Explorador de arquivos",
    "Abre o Explorador do Windows.",
    "Win+E",
  ],
  [
    "Windows",
    "Área de trabalho",
    "Mostra ou oculta a área de trabalho.",
    "Win+D",
  ],
  ["Windows", "Alternar janela", "Alterna para a janela anterior.", "Alt+Tab"],
  [
    "Windows",
    "Visão de tarefas",
    "Mostra janelas e áreas de trabalho.",
    "Win+Tab",
  ],
  [
    "Windows",
    "Bloquear computador",
    "Bloqueia sua sessão do Windows.",
    "Win+L",
  ],
  ["Windows", "Configurações", "Abre as configurações do Windows.", "Win+I"],
  ["Windows", "Executar", "Abre a caixa Executar.", "Win+R"],
  [
    "Windows",
    "Histórico da área de transferência",
    "Requer histórico habilitado no Windows.",
    "Win+V",
  ],
  [
    "Windows",
    "Gerenciador de tarefas",
    "Abre o Gerenciador de Tarefas.",
    "Ctrl+Shift+Esc",
  ],
  ["Navegador", "Nova aba", "Abre uma aba no navegador atual.", "Ctrl+T"],
  ["Navegador", "Fechar aba", "Fecha a aba atual.", "Ctrl+W"],
  [
    "Navegador",
    "Reabrir aba",
    "Restaura a última aba fechada.",
    "Ctrl+Shift+T",
  ],
  ["Navegador", "Próxima aba", "Vai para a próxima aba.", "Ctrl+Tab"],
  [
    "Navegador",
    "Barra de endereço",
    "Seleciona o endereço da página.",
    "Ctrl+L",
  ],
  ["Navegador", "Recarregar página", "Recarrega a aba atual.", "Ctrl+R"],
] as const;
// Only the titles shipped before explicit labelMode existed are legacy labels.
// Extending the catalog must not turn an older custom name into an automatic one.
export const LEGACY_CATALOG_TITLES: readonly string[] = [
  ...shortcuts.map(([, title]) => title), ...Object.values(MEDIA),
  ...[1, 2, 3].map(layer => `Ir para camada ${layer}`),
];
export const CATALOG: CatalogItem[] = [
  ...shortcuts.map(([category, title, description, keys], i) => ({
    id: `shortcut-${i}`,
    category,
    title,
    description,
    action: { kind: "shortcut" as const, keys },
    context: category === "Navegador" ? "Microsoft Edge; pode variar em outros navegadores." : category === "Edição" ? "Conforme aplicativo e idioma." : "Windows; conforme versão e recursos habilitados.",
    source: category === "Navegador" || ["Salvar", "Pesquisar", "Imprimir"].includes(title) ? SHORTCUT_SOURCES.edge : category === "Edição" && title === "Negrito" ? undefined : keys === "Win+Shift+S" ? SHORTCUT_SOURCES.capture : SHORTCUT_SOURCES.windows,
  })),
  ...WINDOWS_SHORTCUT_GROUPS.flatMap((group, index) => group.rows.map(([title, keys], row) => ({
    id: `windows-${index}-${row}`,
    category: group.category,
    title,
    description: group.context,
    context: group.context,
    source: group.source,
    action: { kind: "shortcut" as const, keys },
  }))),
  ...Object.entries(MEDIA).map(([command, title]) => ({
    id: command,
    category: "Mídia",
    title,
    description: "Controle multimídia do sistema.",
    action: { kind: "media" as const, command: command as keyof typeof MEDIA },
  })),
  ...[0, 1, 2].map((value) => ({
    id: `layer-${value}`,
    category: "Camadas",
    title: `Ir para camada ${value + 1}`,
    description: "Somente prévia e motor local. Não muda a camada física; indisponível no modo direto.",
    action: { kind: "layer" as const, value },
  })),
];
