<br>

<p align="center">
  <img src="public/favicon.svg" alt="Meu Keymap" width="72" height="72">
</p>

<h1 align="center">Meu Keymap</h1>

<p align="center">
  Seus atalhos e automações, ao alcance de uma tecla.
</p>

<br>

<p align="center">
  <img src="https://img.shields.io/badge/Windows-30363D?style=for-the-badge" alt="Windows">
  &nbsp;&nbsp;
  <img src="https://img.shields.io/badge/Node.js%2024%2B-30363D?style=for-the-badge&amp;logo=nodedotjs&amp;logoColor=white" alt="Node.js 24 ou superior">
</p>

<br>

<p align="center">
  <a href="#instalação">Instalação</a>
  &nbsp; · &nbsp;
  <a href="#uso">Uso</a>
  &nbsp; · &nbsp;
  <a href="#licença">Licença</a>
</p>

<br>

## Sobre o projeto

Configure as teclas e os encoders do seu macropad em uma interface no navegador. O Meu Keymap integra o **K8850 de 16 teclas e 3 encoders, protocolo 11**, ao Windows.

- Organize seus controles em **perfis e camadas**.
- Crie **atalhos, macros e comandos de mídia**.
- Combine **condições, eventos e scripts** nas automações.

<br>

## Instalação

Requer **Windows**, **Git** e **Node.js 24 ou superior**.

```powershell
git clone https://github.com/patrick-siotti/meu-keymap.git
cd meu-keymap
npm ci
npm run build
```

<br>

## Uso

```powershell
npm start
```

Abra **http://127.0.0.1:4173**, conecte o macropad e escolha um perfil. Selecione uma tecla ou encoder, configure a ação e use **Salvar e aplicar**.

**Direto no aparelho** grava os atalhos compatíveis no macropad.

**Automações no Windows** usa o aplicativo em execução para condições, eventos e scripts.

<br>

## Licença

Distribuído sob a [licença MIT](LICENSE). Autoria de **Patrick G. Siotti**.
