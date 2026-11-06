# Atividade: Detector de Fake News (simplificado)

## Objetivo

Comparar padrões de palavras e de sentimento em títulos informativos e sensacionalistas e construir uma árvore de decisão com Bag of Words.

## Método no Orange

- **Comparação lexical:** duas nuvens de palavras, uma por classe, com pré-processamento e remoção de stopwords em português.
- **Sentimento:** widget **Sentiment Analysis**, método **Multilingual**, idioma **Português (pt)**. Os escores aparecem na tabela ligada ao widget.
- **Classificação:** **Bag of Words → Tree**. O texto é transformado em frequências de palavras; a árvore tenta prever a classe.
- **Avaliação:** **Test & Score** com validação cruzada de 10 partes e **Confusion Matrix** para inspecionar acertos e erros.

## Leitura dos resultados

Os títulos da classe sensacionalista foram escritos com marcadores enfáticos, como “URGENTE”, “BOMBA”, “chocante”, “segredo” e promessas extraordinárias. Os títulos informativos usam linguagem mais neutra, como “divulga”, “publica”, “estudo” e “relatório”. Nas nuvens, observe quais termos se destacam em cada classe. Na tabela de sentimento, compare os escores sem presumir que todo título sensacionalista será negativo: muitos exemplos exageram promessas positivas, e o resultado também depende do léxico usado pelo widget.

A árvore e as métricas demonstram o processo de mineração de texto nesse conjunto didático. Uma pontuação alta aqui não indica que o modelo detecta notícias falsas no mundo real. O conjunto tem apenas 60 exemplos sintéticos, e a classe representa estilo de escrita, não uma checagem factual.

## Limitações

Todas as manchetes foram criadas para a atividade; nenhuma é uma citação de notícia real. “Real (estilo informativo)” significa apenas que o título foi escrito em estilo neutro. Sentimento mede pistas lexicais, não veracidade. Um detector factual exige notícias de fontes documentadas, rótulos verificados e avaliação em dados independentes.
