# Dashboard da central: specs de design e layout

Modo da superfície: **Operate**. Quem usa precisa responder, em poucos segundos, três perguntas: *onde rodo meu job agora?*, *alguma Spark precisa de atenção?* e *a infraestrutura está sendo bem usada?*. Aqui a ambição aparece como precisão e contenção. A identidade CEIA (azul `#1c3882`, ciano de destaque, cantos retos) fica, e o trabalho é dar hierarquia, consistência e calma a ela.

Base analisada: `frontend/app/page.tsx`, `machines/[id]/page.tsx`, `components/{Shell,ui,charts}.tsx`, `globals.css` e `tailwind.config.ts`, mais o detector do Impeccable, que só apontou a fonte Roboto.

> **Revisão com a taste-skill (2.5.1).** A taste-skill é feita para sites institucionais (hero, uma seção por tela, fotografias, "momentos"). Um dashboard autenticado não é isso, então só as regras de **sistema** dela foram aplicadas: tipografia, cor, raio, botões, movimento, acessibilidade e o checklist "um sistema só". O que ficou de fora, e por quê, está na seção 4. As specs marcadas com **[taste]** foram alteradas ou criadas por essa revisão.

---

## 1. Diagnóstico

| # | Problema | Onde | Impacto |
|---|---|---|---|
| D1 | Oito indicadores com o mesmo peso visual, em uma faixa só (`2xl:grid-cols-8`) | `page.tsx` | Nada indica o que olhar primeiro. "Sob pressão" e "Alertas" somem entre os contadores. |
| D2 | A página não responde "qual Spark usar agora". A resposta fica implícita na ordenação da tabela e num selo improvisado ("menos utilizada") | `page.tsx` | É a tarefa principal, e o usuário precisa deduzi-la. |
| D3 | Tabela com 9 colunas e `min-w-[860px]`. Barras de 64 px, estado e classificação com dois selos coloridos concorrendo em cada linha | `page.tsx`, `Bar`, `StatusBadge`, `ClassBadge` | Varredura lenta e muito ruído de cor por linha. |
| D4 | Cores de estado espalhadas: emerald, amber, red, cyan, orange e slate do Tailwind, mais hex fixo em `charts.tsx` e `globals.css` | `ui.tsx`, `charts.tsx` | Não existe uma semântica única. O "alto" laranja e o "aviso" âmbar quase se confundem. |
| D5 | Movimento demais para uma tela de monitoramento: `ping-soft` em **todo** selo online, CountUp a partir de 0 em cada montagem, `bg-drift`, stagger | `globals.css`, `ui.tsx` | Com 10 ou mais máquinas, a tabela fica pulsando o tempo todo e a atenção vai para o que está normal. |
| D6 | Hierarquia tipográfica rasa: h1 em `text-xl`, títulos de card em `text-sm`, valor do indicador em `text-2xl` e o resto em `text-xs` | geral | Títulos e rótulos têm quase o mesmo tamanho, então a tela parece um bloco só. |
| D7 | `main` sem largura máxima. Em monitor largo, tabela e gráficos se esticam até linhas ilegíveis | `Shell.tsx` | Os olhos percorrem distâncias longas demais. |
| D8 | O gráfico comparativo tem 6 cores fixas e repete o ciclo a partir da 7ª máquina | `charts.tsx` `PALETTE` | Duas máquinas ficam com a mesma cor, e a comparação perde o sentido. |
| D9 | A página da máquina tem 6 painéis empilhados de 200 px, cada um com uma requisição própria, e a tabela de estatísticas fica antes dos gráficos | `machines/[id]` | Rolagem longa e a resposta (o gráfico) fica abaixo da dobra. |
| D10 | Acessibilidade: `Bar` tem `aria-label` num `div` sem papel, o heatmap depende só de cor e `title`, e o estado é transmitido principalmente por cor | `ui.tsx`, `charts.tsx` | Leitores de tela e daltonismo ficam mal atendidos. |
| D11 | Roboto aparece como "fonte saturada" no detector | `globals.css` | Só vale trocar se Roboto **não** fizer parte da identidade visual oficial do CEIA. Ver S6. |

Os pontos fortes ficam como estão: os textos honestos ("linhas interrompidas não são zero", "células cinza = sem dados"), os numerais tabulares, o `prefers-reduced-motion` respeitado, a regra de não reanimar nas atualizações por SSE e os estados de carregamento e erro presentes em todos os cards.

---

## 2. Specs

### S1. Tokens semânticos (fundação)
- Criar uma camada semântica em `tailwind.config.ts` e em variáveis CSS (`:root`):
  - Superfície: `surface`, `surface-sunken`, `line`, `line-strong`.
  - Texto: `ink`, `ink-mute`, `ink-faint`.
  - Estado (o único vocabulário de cor permitido para status): `ok`, `warn`, `crit`, `idle` (subutilizada) e `unknown`. Cada um com três tons: `-fg`, `-bg` e `-line`.
  - Dados: `data-1..n`, derivados por escala e não por ciclo (ver S5).
- Mapear tudo para esse vocabulário. Estado: online → `ok`, agente com problema → `warn`, sem comunicação → `crit`. Classificação: subutilizada → `idle`, moderada → neutro, alta → `warn`, pressão → `crit`.
- Proibir classes de cor crua (`emerald-*`, `amber-*`, `orange-*`, `#hex`) em componentes. Hex só em `tailwind.config.ts` e `globals.css`. Charts leem os tokens com `getComputedStyle`.
- Aceite: um `grep -E "(emerald|amber|orange|red|cyan)-[0-9]|#[0-9a-f]{6}"` em `app/` e `components/` não retorna nada.

### S2. Escala tipográfica, raio e espaçamento **[taste]**
- Escala fixa, **nada abaixo de 13 px** (some o `text-[10px]` do selo e do heatmap):
  - `stat` 32/36 medium: valores-chave. Nunca maior que o h1.
  - `title` 24/32 medium: h1.
  - `heading` 16/24 medium: título de card.
  - `body` 14/20: células de tabela (densidade de painel). Já o texto corrido (explicações, motivos da classificação, empty states) fica em 16/24.
  - `label` 13/16 weight 500: rótulos, dicas e tempo.
- **Sem caixa alta com tracking:** o `uppercase tracking-wide` dos indicadores sai e todos os rótulos ficam em *sentence case*.
- Notas explicativas ("Linhas interrompidas…", a nota do ranking de processos) limitadas a 62 caracteres por linha (`max-w-[62ch]`).
- Um número nunca quebra da unidade (`78&nbsp;GB`, `4&nbsp;%`). Vale padronizar isso em `fmtBytes` e `fmtPct`.
- Contraste: `ink` 7:1 ou mais no fundo. `mute` (#5b6b79, cerca de 5:1 em branco) só para rótulos e meta, nunca para texto corrido.
- **Raio `sharp` (4/6/8):** é o perfil que a skill recomenda para ferramentas técnicas. Os cantos 100% retos de hoje parecem inacabados. `--r-sm` 4 em controles, `--r-md` 6 em selos e painéis, `--r-lg` 8 em cards.
- Espaçamento em base 4, com três ritmos: 8 dentro de componentes, 16 entre componentes do mesmo card e 24 entre seções.
- Largura de conteúdo: `.page` com `max-w-[1440px] mx-auto`, margens laterais iguais (24 px no desktop e 16 no celular).

### S2b. Cor: 90 a 95% neutra **[taste]**
- A interface fica neutra. A cor aparece em **três** lugares só: a ação (`brand` #2375e4 em botão primário, link e foco), o estado (S1) e as séries dos gráficos.
- O azul CEIA (`ceia`) fica restrito à sidebar, que funciona como a "faixa de marca" do produto. O ciano vira só o marcador do item ativo.
- Nenhum tom violeta ou lavanda (a skill proíbe), o que tira o `#7a4fd1` da `PALETTE` atual.
- Sem destaque por cor dentro de texto: nada de "⚠" âmbar solto no meio do conteúdo. Aviso é um bloco de estado `warn` com ícone.

### S2c. Botões e controles **[taste]**
- `Button` com 44 px de altura e rótulo de 14 a 16 px. Dois estilos apenas: primário (preenchido, **um por vista**) e secundário (contorno). O `danger` vira uma variante de cor do secundário e só fica preenchido dentro da confirmação.
- O `Segmented` e o `select` de métrica ficam com pelo menos 36 px de altura no desktop e 44 px no toque. Hoje têm cerca de 26 px e falham no checklist de área de toque.
- Os links ganham um estilo único: sublinhado fino em repouso que se desenha ao passar o mouse, aplicado aos nomes das máquinas na tabela.

### S3. Overview: hierarquia "resposta primeiro"
Nova ordem da página `/`:
1. **Cabeçalho**: título, a frase de contexto e, à direita, "atualizado há Xs" e o seletor de janela, que hoje está escondido no card temporal e passa a ser global.
2. **Faixa de atenção**, condicional. Só aparece quando há algo errado: máquinas sem comunicação, sob pressão ou alertas abertos. Uma linha por ocorrência, com link para a máquina ou o alerta, no tom `crit` ou `warn`. Quando está tudo bem, uma linha discreta em `ok`: "Todas as 12 Sparks online, sem pressão de memória."
3. **Recomendação**: card "Melhor opção agora" com as 1 a 3 máquinas que têm mais memória unificada disponível e menos GPU em uso, mostrando o motivo ("78 GB livres · GPU 4% na média de 24h"). Substitui o selo "menos utilizada".
4. **Indicadores em 3 grupos** (eles não podem mais competir entre si):
   - *Frota*: Sparks, Online e Sem comunicação.
   - *Uso agora*: GPU média, Mem. unificada e Mem. disponível.
   - *Período*: Subutilizadas e Sob pressão.
   - Cada grupo tem um rótulo `meta` e os valores em `display`. "Alertas abertos" sai daqui e vai para a faixa de atenção.
5. **Comparativo das máquinas** (tabela, S4).
6. **Comparação temporal** e **Heatmap** lado a lado a partir de `xl` (2/3 + 1/3). Abaixo disso, empilhados.

### S4. Tabela comparativa
- Colunas, de 9 para 7: Máquina (nome + projetos), Estado, GPU (agora + média em uma célula: barra do valor atual e um traço vertical marcando a média), Memória unificada (barra + "X GB livres"), CPU, Disco e Classificação. "Atualização" vira `title`/tooltip no selo de estado e só aparece em texto quando passar de 5 min (aí em `warn`).
- Barras com 96 px, altura de 6 px, trilho `surface-sunken`, cor por limiar (verde nunca: <70 neutro `brand`, 70–89 `warn`, ≥90 `crit`). Componente `Meter` com `role="meter"`, `aria-valuenow/min/max` e `aria-label` com o nome da métrica.
- Estado: só um ponto colorido + texto (sem caixa) quando `online`. A caixa colorida fica reservada para os estados anormais, para que o normal fique calado.
- Classificação: selo só para `pressao` e `subutilizada`, que são as que pedem ação. As demais ficam em texto `ink-mute`.
- Linha inteira clicável (link na célula do nome, com `::after` cobrindo a linha) e foco visível na linha.
- Ordenação pelo cabeçalho (`aria-sort`) em vez do segmentado à parte. A ordenação padrão continua "Menos GPU".
- Abaixo de `md`: a tabela vira uma lista de cartões (nome + estado, 2 medidores principais e a classificação). Sem rolagem horizontal.
- Cabeçalho fixo (`sticky top-0`) quando a tabela passar de 12 linhas.

### S5. Gráficos
- Paleta categórica de até 8 cores validadas (contraste ≥3:1 com o fundo e distinguíveis em deuteranopia). Acima de 8 máquinas, o gráfico comparativo passa a mostrar **top 5 + "demais" agregadas**, ou destaque ao passar o mouse com as demais em cinza. Nunca repetir cores.
- Legenda interativa: clicar destaca ou isola uma série.
- Faixas de 90% (pressão) desenhadas como `ReferenceLine` tracejada em `crit` nos gráficos de percentual.
- Heatmap: escala sequencial de 5 degraus com legenda visível (0, 25, 50, 75 e 100%). Cada célula ganha `aria-label`, e a tabela, `<caption>`. Altura da célula 20 px para caber ao lado do temporal.
- Tooltip e grid passam a usar os tokens, sem hex nem `borderRadius: 0` inline.

### S6. Tipografia da marca
- Verificar no manual de marca do CEIA/UFG se Roboto é a fonte oficial.
  - **Se for**, manter, registrar no DESIGN.md e silenciar o aviso do detector com `impeccable hooks ignore-rule overused-font`.
  - **Se não for**, trocar para uma família de interface com bons numerais tabulares, por exemplo IBM Plex Sans + Plex Mono (pesos 400, 500 e 600, com `font-display: swap`), via `next/font` em vez de `@import` do Google Fonts, que hoje bloqueia a renderização.

### S7. Movimento: só como resposta ao usuário **[taste]**
Regra da skill: o movimento existe para responder ao ponteiro e ao teclado, não para enfeitar. Nada se move só porque a página carregou ou rolou.
- **Tokens únicos** em `globals.css`: `--m-in` 150 ms, `--m-out` 120 ms, `--m-press` 90 ms, `--m-panel` 200 ms e uma curva `--ease: cubic-bezier(.2,.8,.2,1)`, sem bounce nem overshoot. Anima só `transform`, `opacity` e cores, nunca `width`. A `Bar` atual anima `width`, então passa a usar `scaleX`.
- **Camada de hover**, só com ponteiro fino:
  - Botão: sobe 1 px e o fundo escurece um passo. Ao clicar, afunda 1 px e escala para .985.
  - Card de máquina com link (cartões no celular, recomendação): sobe 2 px e a borda escurece.
  - Linha da tabela: só a cor de fundo muda. O ícone da nav deixa de crescer (some o `scale-110`).
- **Remover:**
  - `ping-soft` em todo selo online.
  - `bg-drift`.
  - O stagger dos indicadores e o `.page rise`, porque fade-in em toda seção está na lista "nunca" da skill.
  - O CountUp a partir de 0. O número aparece direto e, numa atualização ao vivo, troca com um `fade` de 150 ms.
  - O zoom de 125% nas células do heatmap. Fica só o contorno no hover e no foco.
- **Fica:** o desenho único das linhas do gráfico na primeira carga (é o conteúdo chegando) e o skeleton.
- Atualização ao vivo: um flash de 600 ms em `surface-sunken` só na célula que mudou de faixa.
- O `prefers-reduced-motion` atual fica como está.

### S8. Shell e navegação
- Sidebar: agrupar a navegação em *Monitorar* (Visão geral, Análise, Alertas com contador), *Organizar* (Projetos) e *Administrar* (Administração, Usuários, só para admin). "Minha conta" e "Sair" vão para o rodapé, junto com o nome do usuário.
- Contador de alertas abertos no item "Alertas" (tom `crit`).
- No celular, a nav horizontal vira uma barra inferior com 4 itens + "Mais", ou um menu em gaveta. A rolagem horizontal das abas atual esconde itens.
- Logo UFG menor (h-8) e fixo no rodapé. O nome do sistema passa a ser o único texto de marca no topo.

### S9. Página da máquina
- Cabeçalho fixo compacto ao rolar: nome, estado, intervalo.
- Ordem: indicadores, gráficos principais (GPU e Memória/PSI) em 2 colunas a partir de `lg` com 240 px de altura, depois os secundários (CPU, Temperatura/Consumo, Disco, Rede) em 2 colunas de 180 px, depois classificação e estatísticas (recolhíveis, abertas por padrão só para admin) e por fim o ranking de processos.
- Uma requisição de métricas por página, com todas as métricas, no lugar das 6 atuais.
- Cursor sincronizado entre os gráficos (`syncId` do Recharts).
- Disponibilidade dos 30 dias como uma faixa de 30 quadrados (um por dia) logo abaixo do cabeçalho.

### S10. Estados e bordas
- Skeletons com o formato do conteúdo: tiles, linhas de tabela e retângulo de gráfico, em vez das 4 barras genéricas.
- Empty states com uma ação clara, quando houver (já existe na tabela, e o padrão se estende ao resto).
- Erro em card não pode deslocar o layout: altura mínima igual à do conteúdo.
- Indicador global de conexão SSE ("ao vivo" / "reconectando…") no cabeçalho.

---

## 3. Etapas de implementação

Cada etapa é um commit isolado e verificável em 1280 px, 1920 px e 390 px.

| Etapa | Escopo | Specs | Arquivos principais | Pronto quando |
|---|---|---|---|---|
| **0. Registro** | Rodar `/impeccable init` (PRODUCT.md) e `/impeccable document` (DESIGN.md) com o estado atual. Decidir S6 | S6 | `PRODUCT.md`, `DESIGN.md` | Os dois documentos existem e a fonte está decidida |
| **1. Tokens** | Camada semântica, escala de tipo, raio `sharp`, cor neutra, migração de todas as cores, charts lendo os tokens | S1, S2, S2b | `tailwind.config.ts`, `globals.css`, `ui.tsx`, `charts.tsx` | O grep de S1 não retorna nada e a tela não muda visualmente além da harmonização de cor |
| **2. Quieter** | Cortes de movimento | S7 | `globals.css`, `ui.tsx` | Tabela parada com 12 máquinas e nada piscando |
| **3. Componentes** | `Button` 44 px, controles maiores, `Meter`, `StatusDot`, `StatGroup`, `DataTable` (sort no cabeçalho, linha clicável, cartões no celular), skeletons novos | S2c, S4, S10 | `components/ui.tsx` → dividir em `components/ui/*` | Componentes usados em pelo menos uma página e a11y verificada com axe |
| **4. Overview** | Nova hierarquia: faixa de atenção, recomendação, grupos de indicadores, grid temporal + heatmap | S3, S4 | `app/page.tsx` (+ campo de recomendação na API, se necessário) | Um usuário novo responde "onde rodo agora?" em menos de 5 s |
| **5. Gráficos** | Paleta escalável, legenda interativa, linha de 90%, legenda do heatmap | S5 | `charts.tsx` | Com 12 séries não há cor repetida, e o heatmap é legível sem cor |
| **6. Shell** | Grupos de navegação, contador de alertas, navegação no celular, largura máxima | S2, S8 | `Shell.tsx` | Nenhum item da navegação fica escondido em 390 px |
| **7. Máquina** | Novo layout, request único, syncId, faixa de disponibilidade | S9 | `machines/[id]/page.tsx`, endpoint de métricas | Os gráficos principais aparecem acima da dobra em 1280×800 |
| **8. Propagar** | Aplicar `DataTable`/`Meter`/tokens em Análise, Projetos, Alertas, Admin e Usuários | S1–S4 | `app/*/page.tsx` | As telas ficam consistentes entre si |
| **9. Checagem** | Checklist da seção 5 em todas as rotas, em 1440, 1024, 768, 390 e 320. `/impeccable audit` e o detector de design | todas | — | Checklist todo verde, nenhum alvo de toque abaixo de 44 px e nada transbordando em 320 px |

Dependências: as etapas 0 e 1 vêm antes de tudo. A etapa 3 vem antes da 4, 7 e 8. As etapas 2, 5 e 6 podem rodar em paralelo depois da 1.

## 4. Itens da taste-skill que não se aplicam ao dashboard
| Regra da skill | Por que fica de fora |
|---|---|
| Hero sozinho na primeira tela e "uma seção por tela" | Num painel operacional, a primeira tela precisa ser densa e mostrar a resposta (atenção + recomendação + tabela), não um hero. |
| Fotografias (12 a 20), stand-ins e créditos | Não há assunto fotográfico. O "produto" são os próprios dados. |
| Momentos, cenas e shaders, entrada animada do hero | É uma ferramenta usada o dia inteiro, e o movimento decorativo vira ruído (S7). |
| Copy de marketing (h1 com categoria e comprador, "fato duro") | O h1 é o nome da tela. A voz já é factual e honesta e deve continuar assim. |
| `gate.mjs`, `consistency.mjs`, `check.mjs` | Os scripts esperam uma página estática pública. O app é dinâmico e exige login, então os critérios deles viraram o checklist manual da seção 5. Daria para rodar contra um build com `fake-central.py` e uma sessão de demonstração, mas os checks de seção e hero falhariam por definição. |

## 5. Checklist de aceite (derivado da taste-skill)
- **Um sistema só:** um par de botões, um estilo de card, uma escala de raio, um estilo de link e uma escala de títulos. No máximo dois níveis de caixa aninhada (hoje há card > tabela > selo com borda > ponto, que precisa achatar).
- **Bordas iguais:** todo bloco alinhado nas mesmas margens do `.page`, sem nada sobrando de um lado e sem rolagem lateral da página em 320 px. A rolagem horizontal da tabela some junto com os cartões no celular.
- **Toque:** todo controle fora de texto corrido com 44 px no celular e a pelo menos 8 px do vizinho.
- **Teclado:** skip link primeiro, anel de foco imediato e nunca escondido, títulos descendo um nível de cada vez, `aria-sort` nas colunas, `role="meter"` nas barras e `aria-current` na nav, o que já existe.
- **Texto:** nada abaixo de 13 px, *sentence case*, número colado à unidade e contraste 7:1 (ink) ou 4.5:1 (mute).
- **Movimento:** cada botão, link e linha responde ao ponteiro. Nada se move sozinho além do desenho inicial do gráfico, e com reduced motion tudo fica parado e visível.
- **Cor:** a tela é neutra em 90% ou mais, sem violeta, e estado sempre vem com texto, nunca só cor.

## 6. Perguntas em aberto
1. Roboto faz parte da identidade oficial do CEIA? Define a S6.
2. A recomendação "melhor opção agora" deve considerar reserva por projeto? Ou seja, uma máquina pode estar livre e, mesmo assim, pertencer a outro projeto.
3. Existe uso em TV ou painel de parede? Se existir, vale um modo "quiosque" com o tema escuro, a faixa de atenção e os indicadores em tamanho grande.
