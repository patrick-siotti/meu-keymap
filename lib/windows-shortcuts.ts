// Microsoft references checked on 2026-10-27. These are configurable chords,
// not a claim that every Windows/app shortcut is supported by every version.
export const SHORTCUT_SOURCES = {
  windows: "https://support.microsoft.com/pt-br/accessibility/windows/keyboard-shortcuts-in-windows",
  accessibility: "https://support.microsoft.com/pt-br/accessibility/windows/windows-keyboard-shortcuts-for-accessibility",
  explorer: "https://support.microsoft.com/en-us/accessibility/windows/use-a-screen-reader-to-explore-and-navigate-file-explorer-in-windows",
  snap: "https://support.microsoft.com/en-us/windows/experience/snap-your-windows",
  desktops: "https://support.microsoft.com/en-us/windows/how-to-multitask-in-windows-b4fa0333-98f8-ef43-e25c-06d4fb1d6960",
  capture: "https://support.microsoft.com/en-us/windows/apps/use-snipping-tool-to-capture-screenshots",
  edge: "https://support.microsoft.com/en-us/edge/keyboard-shortcuts-in-microsoft-edge",
} as const;
interface ShortcutGroup {
  category: string;
  context: string;
  source: string;
  rows: readonly (readonly [title: string, keys: string])[];
}
export const WINDOWS_SHORTCUT_GROUPS: readonly ShortcutGroup[] = [
  { category: "Windows", context: "Windows 10/11; conforme recursos habilitados.", source: SHORTCUT_SOURCES.windows, rows: [
    ["Pesquisar no Windows", "Win+S"], ["Menu de acesso rápido", "Win+X"],
    ["Abrir Iniciar", "Ctrl+Esc"], ["Conectar tela sem fio", "Win+K"],
    ["Projetar tela", "Win+P"],
    ["Foco na barra de tarefas", "Win+T"], ["Foco na bandeja do sistema", "Win+B"],
    ["Alternar idioma de entrada", "Win+Space"], ["Alternar idioma anterior", "Win+Shift+Space"],
  ] },
  { category: "Windows", context: "Windows 11; comportamento pode variar no Windows 10.", source: SHORTCUT_SOURCES.windows, rows: [
    ["Configurações rápidas", "Win+A"], ["Widgets", "Win+W"], ["Central de notificações", "Win+N"],
  ] },
  { category: "Janelas", context: "Janela ativa; conforme aplicativo.", source: SHORTCUT_SOURCES.windows, rows: [
    ["Fechar janela", "Alt+F4"], ["Menu da janela", "Alt+Space"],
    ["Minimizar todas", "Win+M"], ["Restaurar minimizadas", "Win+Shift+M"],
    ["Mover para monitor esquerdo", "Win+Shift+ArrowLeft"], ["Mover para monitor direito", "Win+Shift+ArrowRight"],
  ] },
  { category: "Janelas", context: "Ajuste de janelas do Windows; depende do estado da janela.", source: SHORTCUT_SOURCES.snap, rows: [
    ["Ajustar à esquerda", "Win+ArrowLeft"], ["Ajustar à direita", "Win+ArrowRight"],
    ["Maximizar janela", "Win+ArrowUp"], ["Restaurar ou minimizar", "Win+ArrowDown"],
  ] },
  { category: "Janelas", context: "Áreas de trabalho virtuais do Windows.", source: SHORTCUT_SOURCES.desktops, rows: [
    ["Área de trabalho anterior", "Win+Ctrl+ArrowLeft"], ["Próxima área de trabalho", "Win+Ctrl+ArrowRight"],
  ] },
  { category: "Explorador", context: "Explorador de Arquivos em foco.", source: SHORTCUT_SOURCES.windows, rows: [
    ["Renomear item", "F2"], ["Nova pasta", "Ctrl+Shift+N"],
    ["Propriedades do item", "Alt+Enter"], ["Subir uma pasta", "Alt+ArrowUp"],
    ["Painel de visualização", "Alt+P"], ["Painel de detalhes", "Alt+Shift+P"],
    ["Endereço da pasta", "Alt+D"], ["Atualizar pasta", "F5"],
    ["Excluir permanentemente", "Shift+Delete"],
  ] },
  { category: "Explorador", context: "Explorador de Arquivos em foco.", source: SHORTCUT_SOURCES.explorer, rows: [
    ["Buscar arquivos", "Ctrl+E"], ["Voltar à pasta anterior", "Alt+ArrowLeft"],
    ["Avançar para pasta seguinte", "Alt+ArrowRight"], ["Menu de contexto", "Shift+F10"],
    ["Próximo painel", "F6"], ["Painel anterior", "Shift+F6"],
  ] },
  { category: "Explorador", context: "Abas do Explorador no Windows 11 com suporte a abas.", source: SHORTCUT_SOURCES.windows, rows: [
    ["Nova aba do Explorador", "Ctrl+T"], ["Fechar aba do Explorador", "Ctrl+W"],
    ["Próxima aba do Explorador", "Ctrl+Tab"], ["Aba anterior do Explorador", "Ctrl+Shift+Tab"],
  ] },
  { category: "Edição", context: "Campo de texto em foco; conforme aplicativo.", source: SHORTCUT_SOURCES.windows, rows: [
    ["Apagar palavra anterior", "Ctrl+Backspace"], ["Selecionar palavra à esquerda", "Ctrl+Shift+ArrowLeft"],
    ["Selecionar palavra à direita", "Ctrl+Shift+ArrowRight"], ["Selecionar até início", "Ctrl+Shift+Home"],
    ["Selecionar até fim", "Ctrl+Shift+End"],
  ] },
  { category: "Acessibilidade", context: "Windows; alguns recursos exigem ativação nas configurações.", source: SHORTCUT_SOURCES.accessibility, rows: [
    ["Digitação por voz", "Win+H"], ["Foco na digitação por voz", "Win+Alt+H"],
    ["Acessibilidade", "Win+U"], ["Teclado virtual", "Win+Ctrl+O"],
    ["Configurações do Narrador", "Win+Ctrl+N"], ["Filtros de cor", "Win+Ctrl+C"],
    ["Alto contraste", "Alt+Shift+PrintScreen"],
  ] },
  { category: "Captura", context: "Windows; Print Screen pode abrir o recorte conforme configuração.", source: SHORTCUT_SOURCES.capture, rows: [
    ["Capturar tela inteira", "PrintScreen"],
  ] },
  { category: "Captura", context: "Windows 11 com Ferramenta de Captura compatível com gravação.", source: SHORTCUT_SOURCES.capture, rows: [
    ["Gravar região da tela", "Win+Shift+R"],
  ] },
  { category: "Captura", context: "Windows; captura da janela ativa ou arquivo em Imagens.", source: SHORTCUT_SOURCES.windows, rows: [
    ["Capturar janela ativa", "Alt+PrintScreen"], ["Salvar captura da tela", "Win+PrintScreen"],
  ] },
  { category: "Navegador", context: "Microsoft Edge em foco; outros navegadores podem variar.", source: SHORTCUT_SOURCES.edge, rows: [
    ["Aba anterior", "Ctrl+Shift+Tab"], ["Nova janela", "Ctrl+N"],
    ["Janela InPrivate", "Ctrl+Shift+N"], ["Histórico do navegador", "Ctrl+H"],
    ["Downloads", "Ctrl+J"], ["Adicionar aos favoritos", "Ctrl+D"],
    ["Favoritos", "Ctrl+Shift+O"], ["Tela cheia", "F11"],
    ["Ferramentas do desenvolvedor", "F12"], ["Colar sem formatação", "Ctrl+Shift+V"],
    ["Ampliar página", "Ctrl++"], ["Reduzir página", "Ctrl+-"], ["Restaurar zoom", "Ctrl+0"],
  ] },
];
