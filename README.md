# Chess Lab — versão 1.0

Aplicação web de treinamento e análise de xadrez, com interface desktop, tabuleiro interativo, histórico, importação de FEN/PGN e engine Stockfish em Web Worker.

## Requisitos
- Node.js 20 ou superior.
- Conexão com a internet para instalar dependências.
- Navegador moderno.

## Instalação e execução

```bash
npm install
npm run dev
```

## Build

```bash
npm run build
npm run preview
```

## Engine Stockfish
O projeto usa `stockfish@19.0.1`, variante Lite single-threaded, copiada para `public/engine` pelo script `postinstall`.

## Controles
- Clique numa peça e depois numa casa destacada para mover.
- Voltar, Avançar, Início e Fim navegam pelo histórico.
- Girar inverte a orientação do tabuleiro.
- Jogar contra engine alterna entre modo livre e contra Stockfish.
- FEN / PGN importa posições e partidas.
- Exportar PGN copia a partida atual.
- A análise pode ser pausada e a profundidade ajustada.

## Licença
Stockfish.js é distribuído sob GPL-3.0. Preserve os avisos de licença e cumpra as obrigações aplicáveis ao redistribuir o motor.
