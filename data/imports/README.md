# Amostra pública para demonstração

`pam-sp-2023.csv` contém a resposta SIDRA da PAM (tabela 5457) para os 645 municípios do estado de São Paulo, ano-base 2023, soja, milho e cana-de-açúcar. As nove combinações de variáveis são área plantada/destinada à colheita, quantidade produzida e rendimento médio. Registros sem os três valores completos são descartados pelo importador antes da persistência.

`inmet-sp-a763-2024.zip` contém apenas o CSV oficial de 2024 da estação automática A763/Marília, a estação incluída mais próxima do campus da Fatec Pompéia. O arquivo tem cerca de 212 KiB compactado e resulta em 8.784 observações horárias. Marília é a origem dos dados climáticos; a fazenda e os polígonos sintéticos continuam posicionados somente no campus.

Os dois arquivos são carregados automaticamente por `make demo` e mantêm o ranking e o histórico climático disponíveis sem consulta a serviços externos durante a execução. Eles não substituem os polígonos de talhão, que são sintéticos e ficam próximos exclusivamente ao campus da Fatec Pompéia.

Para atualizar o arquivo a partir das APIs públicas do IBGE:

```bash
python scripts/download_pam_sp.py
```

Fontes: [API SIDRA, tabela 5457](https://apisidra.ibge.gov.br/values/t/5457), [API de Localidades do IBGE, municípios de São Paulo](https://servicodados.ibge.gov.br/api/v1/localidades/estados/35/municipios?orderBy=nome) e [Dados históricos anuais do INMET](https://portal.inmet.gov.br/dadoshistoricos/). Consulta e recorte realizados em 30/10/2026. Os campos mantêm os nomes e códigos originais usados nas exportações oficiais.
