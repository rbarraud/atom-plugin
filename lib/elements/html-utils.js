const path = require('path');
const {head, compact, flatten} = require('../utils');
const {
  symbolLabel, symbolType,
  valueLabel, valueType, idIsEmpty,
  memberLabel, parameterName, parameterType, parameterDefault,
} = require('../kite-data-utils');

const {
  highlightChunk,
  wrapLine,
  wrapPre,
} = require('../highlighter');

const Plan = require('../plan');

const pluralize = (a, s, p) => a.length === 1 ? s : p;

function proFeatures(message) {
  return Plan.hasStartedTrial()
    ? `<div class="kite-pro-features">
      ${message},
      <a is="kite-localtoken-anchor"
         href="http://localhost:46624/redirect/pro">upgrade to Kite Pro</a>, or
      <a is="kite-localtoken-anchor"
         href="http://localhost:46624/redirect/invite">get Kite Pro for free</a>
      </div>`
    : `${message},
      <a is="kite-localtoken-anchor"
         href="http://localhost:46624/redirect/trial">start your Kite Pro trial</a> at any time`;
}

function highlightCode(content) {
  return wrapPre(
    content.split('\n')
    .map(highlightChunk)
    .map(wrapLine)
    .join(''));
}

function stripBody(html) {
  return (html || '').replace(/<body>/, '').replace(/<\/body>/, '');
}

function valueDescription(data) {
  const {value} = data;

  return `<div class="description">${data.report &&
         data.report.description_html &&
         data.report.description_html !== ''
    ? stripBody(data.report.description_html)
    : value.synopsis}</div>`;
}

function symbolDescription(data) {
  const symbol = head(data.symbol);
  const value = head(symbol.value);

  return data.report &&
         data.report.description_html &&
         data.report.description_html !== ''
    ? stripBody(data.report.description_html)
    : (value.synopsis != '' ? value.synopsis : symbol.synopsis);
}

function renderSymbolHeader(symbol) {
  return renderHeader(symbolLabel(symbol), symbolType(symbol));
}

function renderValueHeader(symbol) {
  return renderHeader(valueLabel(symbol), valueType(symbol));
}

function renderHeader(name, type) {
  return `
  <div class="expand-header split-line">
    <span class="name">${name}</span>
    <span class="type">${type}</span>
  </div>`;
}

function debugData(data) {
  return atom.config.get('kite.developerMode')
    ? `<div class="debug">
        ${highlightCode(JSON.stringify(data, null, 2))}
      </div>`
    : '';
}

function parameterize(string) {
  return string.toLowerCase().replace(/\s+/g, '-');
}

function section(title, content) {
  return `<section class="${parameterize(title)}">
    <h4>${title}</h4>
    <div class="section-content">
      ${content}
    </div>
  </section>`;
}

function renderExtend(symbol) {
  return '';
  // return !symbol.bases || symbol.bases.length === 0
  //   ? ''
  //   : `
  //   <div class="expand-extend split-line">
  //     <span class="name">
  //       <a href="kite-atom-internal://base/method">BaseCounter.increment(n)</a>
  //     </span>
  //     <span class="type"><a href="kite-atom-internal://base/return">-> int</a></span>
  //   </div>`;
}

function renderDefinition(value) {
  const def = value.report && value.report.definition;
  if (def && def.filename && def.filename.trim() !== '') {
    const url = `kite-atom-internal://goto/${stripLeadingSlash(def.filename)}:${def.line}`;

    return section('Definition', `
    <ul>
      <li>
        <i class="icon icon-file-code"></i>
        <a href="${url}" class="file">
          <span class="title">${path.basename(def.filename)}:${def.line}</span>
          <i class="icon icon-chevron-right"></i>
        </a>
      </li>
    </ul>`);
  } else {
    return '';
  }
}

function renderLinks(data, limit = 2) {
  return data.report && data.report.links && data.report.links.length
    ? section('Links', `
      <ul>${data.report.links.slice(0, limit).map(renderLink).join('')}</ul>
      ${additionalLinksLink(data.report.links.length - 2, data)}
    `)
    : '';
}

function renderLink(link) {
  return `<li data-name="${link.title}">
    <i class="icon icon-so"></i>
    <a href="${link.url}" class="link">
      <span class="title">${link.title}</span>
      <i class="icon icon-chevron-right"></i>
    </a>
  </li>`;
}

function additionalLinksLink(linksCount, data) {
  return linksCount <= 0
    ? ''
    : `<a href="kite-atom-internal://links-list/${data.value.id}"
          class="more-links">See ${linksCount} more links</a>`;
}

function renderExamples(data, limit = 2) {
  return data.report && data.report.examples && data.report.examples.length
    ? section('Examples', `
      <ul>${data.report.examples.slice(0, limit).map(renderExample).join('')}</ul>
      ${additionalExamplesLink(data.report.examples.length - 2, data)}
    `)
    : '';
}

function renderExample(example) {
  return `<li data-name="${example.title}">
    <i class="icon icon-code"></i>
    <a href="kite-atom-internal://example/${example.id}" class="example">
      <span class="title">${example.title}</span>
      <i class="icon icon-chevron-right"></i>
    </a>
  </li>`;
}

function additionalExamplesLink(examplesCount, data) {
  return examplesCount <= 0
    ? ''
    : `<a href="kite-atom-internal://examples-list/${data.value.id}"
          class="more-examples">See ${examplesCount} more examples</a>`;
}

function renderUsages(symbol) {
  return symbol.report && symbol.report.usages && symbol.report.usages.length
    ? section('Usages from your code',
      Plan.can('usages_editor')
        ? `<ul class="usages-box">
          ${symbol.report.usages.map(renderUsage).join('')}
        </ul>`
        : proFeatures(`To see ${symbol.report.usages.length} ${pluralize(symbol.report.usages, 'usage', 'usages')}`))
    : '';
}

function renderUsage(usage) {
  const base = path.basename(usage.filename);
  const url = [
    `kite-atom-internal://goto/${stripLeadingSlash(usage.filename)}`,
    usage.line,
    usage.begin_runes,
  ].join(':');

  return `<div class="usage-container">
    <div class="usage-bullet"></div>
    <li class="usage">
      ${highlightCode(usage.code.trim())}
      <div class="links">
        <a href="${url}">${base}:${usage.line}</a>
      </div>
    </li>
  </div>`;
}

function renderMembers(value, limit) {
  if (!value || !value.detail) { return ''; }

  const {members, total_members} = value.detail;

  return members.length === 0
    ? ''
    : (limit != null
      ? section('Top members', `
        <ul>
          ${members.slice(0, limit).map(m => renderMember(m)).join('')}
        </ul>
        ${additionalMembersLink(total_members - limit, value)}`)
      : section('Top members', `
        <ul>
          ${members.map(m => renderMember(m)).join('')}
        </ul>
        ${total_members > members.length
          ? additionalMembersLink(total_members - members.length, value)
          : ''
        }`));
}

function stripLeadingSlash(str) {
  return str.replace(/^\//, '');
}

function renderMember(member) {
  const label = !idIsEmpty(member.id)
    ? `<a href="kite-atom-internal://member/${member.id}">${memberLabel(member)}</a>`
    : memberLabel(member);

  if (member.value) {
    const type = head(member.value).kind;
    const synopsis = head(member.value).synopsis;

    const description = synopsis ? `<p>${synopsis}</p>` : '';

    return `<li data-name="${member.name}">
    <div class="split-line">
    <span class="name">${label}</span>
    <span class="type">${type}</span>
    </div>
    ${description}
    </li>`;
  } else {
    return '';
  }
}

function additionalMembersLink(membersCount, value) {
  return membersCount <= 0
    ? ''
    : `<a href="kite-atom-internal://members-list/${value.id}"
          class="more-members">See ${membersCount} more members</a>`;
}

function renderParameters(value) {
  const {detail} = value;

  const allParameters = compact(flatten([
    detail ? detail.parameters : null,
    detail ? detail.vararg : null,
    detail ? detail.kwarg : null,
  ]));

  return detail &&
         allParameters.length /*&&
         allParameters.some(p => p.synopsis && p.synopsis !== '')*/
    ? section('Parameters', `
    <dl>
      ${detail.parameters
        ? detail.parameters.map(p => renderParameter(p)).join('')
        : ''}
      ${renderParameter(detail.vararg, '*')}
      ${renderParameter(detail.kwarg, '**')}
    </dl>`)
    : '';
}

function renderParameter(param, prefix = '', highlight = false) {
  return !param
    ? ''
    : `<dt class="split-line ${highlight ? 'highlight' : ''}">
      <span class="name">${parameterName(param, prefix)}${parameterDefault(param)}</span>
      <span class="type">${parameterType(param)}</span>
    </dt>
    <dd>${param.synopsis}</dd>
    `;
}

function renderInvocations(symbol) {
  return '';
//   return section('Invocations', `<pre><code>Counter.increment(10)
// Counter.increment(10, foo='bar')</code></pre>`);
}

module.exports = {
  debugData,
  highlightCode,
  pluralize,
  proFeatures,
  renderDefinition,
  renderExample,
  renderExamples,
  renderExtend,
  renderInvocations,
  renderLink,
  renderLinks,
  renderMember,
  renderMembers,
  renderParameter,
  renderParameters,
  renderSymbolHeader,
  renderUsages,
  renderValueHeader,
  section,
  symbolDescription,
  valueDescription,
};
