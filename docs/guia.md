# Guia do Meu Keymap

## Perfis e mapa do aparelho

Em **Conectar macropad → Mapear por código**, o Meu Keymap lê a configuração das três camadas. Cada camada tem 25 posições, com 16 teclas e nove canais de encoder. Os códigos 1–16 são as teclas. Os grupos 17–19, 20–22 e 23–25 correspondem a giro à esquerda, clique e giro à direita dos três encoders.

A leitura inclui posições vazias e posições com a mesma ação. A camada exibida no editor serve para navegar pelo mapa. Para trocar a camada do aparelho, use o seletor físico. O motor reconhece a camada física pelo próximo gesto recebido.

- **Criar perfil com esta leitura** importa as ações reconhecidas para um perfil separado. Uma posição com ação desconhecida bloqueia a importação. As leituras originais ficam em `.data/hardware-backups/`.
- **Abrir no perfil atual** seleciona o endereço lido no rascunho. Use **Guardar sem aplicar** para salvar a edição em disco.
- **Salvar e aplicar** salva o perfil e confirma a aplicação por releitura. Se a aplicação falhar depois do salvamento, a interface mostra **Salvo no computador, mas NÃO aplicado**.
- **Importar** carrega um rascunho, e **Exportar** baixa um JSON. O formato atual migra perfis v1 e v2 em memória. É possível duplicar, renomear e excluir perfis mantendo pelo menos um.

O arquivo `.data/profiles.json` contém o documento versionado, com cópia anterior em `.data/profiles.previous.json`. Revisões detectam conflitos entre abas. O motor usa o último perfil aplicado. Um perfil exportado contém as configurações do editor, enquanto os backups de leitura conservam os relatórios do aparelho.

## Gatilhos e condições

Em **Teclas**, selecione o controle e use **Adicionar gatilho**. Cada regra tem uma condição **Se** e pode ter ações e transições de evento independentes em **Então** e **Senão**.

| Gatilho | Quando dispara |
| --- | --- |
| **Clique** | Em um toque. Se houver regra de duplo clique, o motor aguarda até 400 ms pelo segundo toque. |
| **Duplo clique** | Em dois toques dentro da janela de 400 ms. |
| **Pressionar** | No início da pressão, nos modos Misto e Automações no Windows. |
| **Segurar** | Uma vez após 400 ms. Quando a regra se aplica ao gesto, substitui o Clique da mesma pressão. |
| **Soltar** | No fim da pressão, nos modos Misto e Automações no Windows. |
| **Giros** | Quando um encoder gira para a esquerda ou para a direita. |
| **Ativação de camada** | Ao entrar em uma camada lógica, em Automações no Windows. |

É possível usar modificadores ou combinar a regra com outra tecla. Cada perfil pode reservar até cinco posições para acompanhar pressão e soltura, somando as três camadas. O motor usa sinais reservados de F13 a F24 para identificar posições. No modo Misto, atalhos que conflitam com esses sinais também passam pelo motor.

**Se** aceita grupos E/OU, estados de eventos, teclas pressionadas, processos e valores de fontes. Se um dado da condição estiver indisponível, o motor segue **Senão**. Use **Testar → Simular gatilho** para acompanhar a lógica em prévia antes de aplicá-la ao Windows.

Em **Eventos**, crie um evento com os estados de que precisar. Uma regra pode definir, avançar, voltar ou reiniciar o estado. Cada estado pode executar uma ação ao entrar e ter condições próprias. Se a entrada falhar na condição, o evento mantém o estado anterior e executa o ramo **Senão** configurado. Com o perfil aplicado e o motor ativo, o editor mostra o estado em execução.

## Ditado com mudo temporário

O Meu Keymap mantém pressionado o atalho que você configurar no aplicativo de ditado. Use a combinação que esse aplicativo reconhece como **segurar para ditar**.

1. Selecione **Misto** ou **Automações no Windows**.
2. Em **Teclas**, selecione uma tecla e adicione o gatilho **Pressionar**.
3. Em **Então → Ação**, crie um **Atalho de teclado** com a combinação de ditado.
4. Marque **Manter o atalho pressionado até soltar a tecla** e **Silenciar a saída de áudio até soltar a tecla**.
5. Use **Salvar e aplicar**. Segure a tecla para ditar e solte para encerrar. O mudo temporário atua nas saídas de áudio ativas. O microfone usado pelo ditado continua disponível e as saídas voltam ao estado anterior.

Para acompanhar a pressão no painel **Eventos**, crie um evento com os estados **Inativo** e **Ativo**. Em **Então → Evento**, use **Definir um estado** para selecionar **Ativo** no gatilho **Pressionar** e **Inativo** no gatilho **Soltar**.

## Ações e fontes de condição

- **Atalhos e macros.** Use a captura ou monte a combinação escolhendo modificadores e tecla. O modo direto admite até 18 entradas por macro, contando os modificadores.
- **Texto e scripts.** As ações do Windows podem escrever texto ou rodar um executável, PowerShell, Python ou lote. Use caminhos absolutos, argumentos em linhas separadas, pasta de trabalho opcional e tempo máximo. Os interpretadores precisam estar instalados. A digitação depende do foco e do nível de permissão da janela.
- **Ícones.** Escolha um ícone automático ou da biblioteca ou importe PNG, JPEG ou WebP de até 2 MiB. O app converte a imagem para um PNG de até 128×128 e 128 KiB, incluído ao exportar o perfil.
- **Windows.** As condições podem consultar processos, nível, volume e mudo do microfone padrão. O leitor mede por Core Audio sem gravar áudio. Amostras com mais de 2,5 segundos ficam sem dados. O nível é medido antes da atenuação, por isso há uma condição de mudo separada.
- **OBS.** Em **Execução → Fontes do OBS**, informe a porta e a senha do WebSocket 5 local e selecione a fonte de áudio. O adaptador lê o estado de gravação, pausa, transmissão e os dados de áudio da fonte. Porta, senha e fonte valem para a sessão atual. Use as condições para reagir aos dados. O adaptador do OBS é de leitura.

## Execução, bandeja e inicialização

Na bandeja do Windows, clique duas vezes no ícone **Meu Keymap** para abrir a interface. O menu do ícone também tem **Abrir Meu Keymap** e **Sair**. Com o motor ativo, fechar a aba mantém as automações. **Sair** fecha o aplicativo e encerra o motor.

Em **Execução → Inicialização com o Windows**, ative a opção para iniciar na bandeja no próximo login. O aplicativo espera o macropad e retoma o último perfil aplicado quando o mapa confere. Ações de entrada de camada permanecem reservadas às ativações durante a sessão. Abra **Execução** para consultar o perfil, os estados e o registro de ações ou para parar e iniciar o motor. Se o mapa divergir, confira o aparelho antes de retomar.

Ao iniciar manualmente, se o motor estiver parado, escolha **Iniciar** em **Execução** ou aplique um perfil. A sessão iniciada pelo atalho encerra após 15 segundos sem abas se o motor estiver parado. Se nenhuma aba se conectar na abertura, o prazo é de 60 segundos.

Para uso técnico, `.\iniciar.ps1 -SemAbrir` inicia o servidor em segundo plano, fora do ciclo de abas do aplicativo da bandeja. `npm start` executa a versão compilada. A aplicação escuta em `127.0.0.1`.

## LEDs e conferência

Em **LEDs**, leia a configuração atual e selecione a camada de destino e as posições. Use o seletor ou informe uma cor hexadecimal. Preto apaga as posições selecionadas. **Gravar LEDs** aplica a cor em modo estático nas camadas escolhidas e relê a configuração. A releitura confirma os valores armazenados. Para confirmar a cor visível, confira as teclas no aparelho.

Os bancos e posições fora da seleção são preservados. O ajuste de LEDs dos encoders e efeitos de luz dinâmicos ficam fora desse fluxo. O backup de RGB fica em `.data/rgb-backups/`.

Em **Conectar macropad → Conferir controles físicos**, selecione o endereço esperado e acione o controle físico na mesma camada. Isso pausa a entrada de ações durante o teste e mostra divergências de código ou de camada. Encerrar a conferência retoma a entrada. O **Diagnóstico das saídas atuais** é uma captura opcional dos sinais emitidos pelos controles já programados.

## Backup e recuperação

Ao aplicar o perfil, o app lê o mapa, cria o backup e relê os 75 registros para confirmar o resultado. Se uma escrita for parcial, tenta restaurar o mapa anterior e confirma a restauração por releitura. Uma falha de recuperação interrompe novas escritas até que seja tratada.

- **Execução → Reler e conferir atalhos** compara o mapa atual com o perfil aplicado.
- **Execução → Restaurar atalhos anteriores** para o motor e devolve o mapa salvo antes da automação.
- O backup de RGB é separado. As alterações no perfil atuam no mapa de teclas. Para gravar cores, use **Gravar LEDs**.

A integração atua nos relatórios USB do K8850 16+3 com protocolo 11. Compatibilidade de escrita com outras revisões e modelos precisa ser confirmada antes do uso. Backups de mapa e de LEDs preservam a configuração lida.
