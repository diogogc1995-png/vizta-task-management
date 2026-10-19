// Primeira utilização: cria as folhas modelo na pasta do Drive e o dashboard inicial.
import { CONFIG } from './config.js';
import { uid } from './util.js';

export const SALES_STAGES = ['Por contactar', 'Contactado', 'Reunião agendada', 'Proposta enviada', 'Em negociação', 'Ganho', 'Perdido'];
export const FUNDING_STAGES = ['Identificado', 'Contactado', 'Reunião agendada', 'Candidatura em preparação', 'Submetido', 'Em análise', 'Aprovado', 'Recusado'];
const FUNDING_TYPES = ['Banco', 'Capital de risco', 'Business angel', 'Apoio público (PT2030/PRR)', 'Família e amigos', 'Outro'];

const SALES_HEADERS = ['Nome', 'Empresa', 'Cargo', 'Email', 'Telefone', 'Estado', 'Valor estimado', 'Último contacto', 'Próximo passo', 'Data próximo passo', 'Responsável', 'Notas'];
const FUNDING_HEADERS = ['Entidade', 'Tipo', 'Programa / Produto', 'Montante', 'Estado', 'Pessoa de contacto', 'Email', 'Último contacto', 'Próximo passo', 'Data próximo passo', 'Responsável', 'Notas'];
const at = (headers, name) => headers.indexOf(name);

const w = (type, title, w_, h, extra = {}) => ({ id: uid(), type, title, w: w_, h, ...extra });

export async function createInitialDashboard(api, ownerEmail) {
  const sales = await api.createSpreadsheet({
    title: 'Funil de Vendas',
    tab: 'Contactos',
    headers: SALES_HEADERS,
    validations: [{ col: at(SALES_HEADERS, 'Estado'), values: SALES_STAGES }],
    dateCols: [at(SALES_HEADERS, 'Último contacto'), at(SALES_HEADERS, 'Data próximo passo')],
    currencyCols: [at(SALES_HEADERS, 'Valor estimado')],
  });
  const funding = await api.createSpreadsheet({
    title: 'Financiamentos',
    tab: 'Entidades',
    headers: FUNDING_HEADERS,
    validations: [
      { col: at(FUNDING_HEADERS, 'Estado'), values: FUNDING_STAGES },
      { col: at(FUNDING_HEADERS, 'Tipo'), values: FUNDING_TYPES },
    ],
    dateCols: [at(FUNDING_HEADERS, 'Último contacto'), at(FUNDING_HEADERS, 'Data próximo passo')],
    currencyCols: [at(FUNDING_HEADERS, 'Montante')],
  });
  const S = { ...sales, tab: 'Contactos' };
  const F = { ...funding, tab: 'Entidades' };
  const closedSales = { column: 'Estado', mode: 'exclude', values: ['Ganho', 'Perdido'] };
  const closedFunding = { column: 'Estado', mode: 'exclude', values: ['Aprovado', 'Recusado'] };

  const cfg = {
    schema: 1,
    title: CONFIG.APP_TITLE,
    owner: ownerEmail,
    users: [],
    sections: [
      {
        id: 'vendas', title: 'Funil de Vendas', access: {}, widgets: [
          w('kpi', 'Contactos', 3, 2, { source: S, mode: 'count', format: 'number' }),
          w('kpi', 'Em curso', 3, 2, { source: S, mode: 'count', format: 'number', filter: { column: 'Estado', mode: 'include', values: ['Contactado', 'Reunião agendada', 'Proposta enviada', 'Em negociação'] } }),
          w('kpi', 'Ganhos', 3, 2, { source: S, mode: 'count', format: 'number', filter: { column: 'Estado', mode: 'include', values: ['Ganho'] } }),
          w('kpi', 'Valor em pipeline', 3, 2, { source: S, mode: 'sum', valueColumn: 'Valor estimado', format: 'currency', filter: closedSales }),
          w('kanban', 'Funil', 12, 5, { source: S, groupColumn: 'Estado', stages: SALES_STAGES, titleColumn: 'Nome', subtitleColumns: ['Empresa', 'Próximo passo'], dateColumn: 'Data próximo passo' }),
          w('agenda', 'Próximos passos', 6, 5, { source: S, dateColumn: 'Data próximo passo', titleColumn: 'Nome', detailColumn: 'Próximo passo', filter: closedSales }),
          w('chart', 'Contactos por estado', 6, 5, { source: S, chartType: 'bar', mode: 'count', groupColumn: 'Estado', stages: SALES_STAGES }),
          w('table', 'Todos os contactos', 12, 6, { source: S, stageColumn: 'Estado', stages: SALES_STAGES, titleColumn: 'Nome', columns: ['Nome', 'Empresa', 'Estado', 'Último contacto', 'Próximo passo', 'Data próximo passo', 'Responsável'] }),
        ],
      },
      {
        id: 'apresentacao', title: 'Apresentação Institucional', access: {}, widgets: [
          w('file', 'Apresentação', 12, 8, { file: null }),
          w('notes', 'Como partilhar', 12, 2, { text: '1) Carregue o PDF ou Google Slides para a pasta do Drive.\n2) Ative "Editar", clique em ⚙ no widget "Apresentação" e escolha o ficheiro.\n3) Clique em "Link público" no topo para obter um link só de visualização para enviar a qualquer pessoa.' }),
        ],
      },
      {
        id: 'financiamentos', title: 'Financiamentos', access: {}, widgets: [
          w('kpi', 'Entidades', 3, 2, { source: F, mode: 'count', format: 'number' }),
          w('kpi', 'Em curso', 3, 2, { source: F, mode: 'count', format: 'number', filter: closedFunding }),
          w('kpi', 'Montante em análise', 3, 2, { source: F, mode: 'sum', valueColumn: 'Montante', format: 'currency', filter: closedFunding }),
          w('kpi', 'Montante aprovado', 3, 2, { source: F, mode: 'sum', valueColumn: 'Montante', format: 'currency', filter: { column: 'Estado', mode: 'include', values: ['Aprovado'] } }),
          w('kanban', 'Estado dos financiamentos', 12, 5, { source: F, groupColumn: 'Estado', stages: FUNDING_STAGES, titleColumn: 'Entidade', subtitleColumns: ['Programa / Produto', 'Montante', 'Próximo passo'], dateColumn: 'Data próximo passo' }),
          w('agenda', 'Próximos passos', 6, 5, { source: F, dateColumn: 'Data próximo passo', titleColumn: 'Entidade', detailColumn: 'Próximo passo', filter: closedFunding }),
          w('chart', 'Entidades por tipo', 6, 5, { source: F, chartType: 'doughnut', mode: 'count', groupColumn: 'Tipo', stages: FUNDING_TYPES }),
          w('table', 'Entidades contactadas', 12, 6, { source: F, stageColumn: 'Estado', stages: FUNDING_STAGES, titleColumn: 'Entidade', columns: ['Entidade', 'Tipo', 'Montante', 'Estado', 'Pessoa de contacto', 'Próximo passo', 'Data próximo passo'] }),
        ],
      },
      {
        id: 'business-plans', title: 'Business Plans', access: {}, widgets: [
          w('table', 'Business plan', 12, 7, { source: null }),
          w('files', 'Ficheiros na pasta', 12, 4),
        ],
      },
    ],
  };
  return cfg;
}
