'use strict';

require('./kite-logo');
require('./kite-open-link');
require('./kite-expand-navigation');
require('./navigable-stack');
require('./navigable-stack-breadcrumb');

const url = require('url');
const {CompositeDisposable, Range} = require('atom');
const {Logger} = require('kite-installer');
const metrics = require('../metrics.js');

const KiteExpandFunction = require('./kite-expand-function');
const KiteExpandInstance = require('./kite-expand-instance');
const KiteExpandModule = require('./kite-expand-module');
const KiteMembersList = require('./kite-members-list');
const KiteExamplesList = require('./kite-examples-list');
const KiteLinksList = require('./kite-links-list');
const KiteCuratedExample = require('./kite-curated-example');
const DataLoader = require('../data-loader');
const VirtualCursor = require('../virtual-cursor');
const LinkScheme = require('../link-scheme');
const Plan = require('../plan');

const {head, last, addDelegatedEventListener, DisposableEvent, truncate} = require('../utils');
const {symbolName, symbolKind, reportFromHover, valueNameFromId} = require('../kite-data-utils');

class NavigablePanel extends HTMLElement {
  subscribe() {
    this.setAttribute('tabindex', '-1');
    this.classList.add('native-key-bindings');

    this.subscriptions = this.subscriptions || new CompositeDisposable();
    // this.subscriptions.add(addDelegatedEventListener(this, 'click', 'section h4', (e) => {
    //   parent(e.target, 'section').classList.toggle('collapsed');
    // }));

    this.subscriptions.add(addDelegatedEventListener(this, 'click', 'a.internal_link', (e) => {
      const id = last(e.target.href.split('#'));
      this.stackDataForId(id, e.target);
      e.preventDefault();

      metrics.track('Expand UI internal link clicked');
    }));

    this.subscriptions.add(this.breadcrumb.subscribeToStack(this.content));

    this.createLinkScheme();
  }

  unsubscribe() {
    this.subscriptions.dispose();
  }

  clear() {
    this.content.clear();
    this.breadcrumb.clear();
  }

  setData([hover, report]) {
    this.clear();

    let element, data, label;

    console.log(hover, report);

    metrics.track('Expand UI shown');

    // So, as of 2017-01-25, we still have to juggle between hover
    // and report data. The following rules apply:
    // - for instances, we don't get any report, but eventhough we
    //   receive a report, we're not sure that the value repr
    //   give us the name
    // - for functions, types and modules we use the report in
    //   priority and then fallback to the hover first value
    const kind = hover
      ? symbolKind(head(hover.symbol))
      : report.value.kind;

    const name = hover
      ? symbolName(head(hover.symbol))
      : report.value.name;

    switch (kind) {
      case 'instance':
        element = new KiteExpandInstance();
        label = name;
        element.setData(report || reportFromHover(hover));
        break;
      case 'function':
        element = new KiteExpandFunction();
        label = name;
        element.setData(report || reportFromHover(hover));
        break;
      case 'module':
      case 'type':
        element = new KiteExpandModule();
        label = name;
        element.setData(report || reportFromHover(hover));
        break;
      default:
        element = document.createElement('pre');
        label = 'unknown';
        element.innerHTML = `<code>${JSON.stringify(data, null, 2)}</code>`;
    }

    if (element) {
      this.stack(label, element);
    }
  }

  stack(label, element) {
    this.content.stack(label, element);
  }

  goto(depth) {
    if (typeof depth === 'string') {
      depth = this.breadcrumb.indexOf(depth);
    }

    this.content.goto(depth);
  }

  previous() {
    this.content.previous();
  }

  next() {
    this.content.next();
  }

  showDataAtPosition(editor, position) {
    const cursor = new VirtualCursor(editor, position);
    const range = cursor.getCurrentWordBufferRange({
      includeNonWordCharacters: false,
    });

    return this.showDataAtRange(editor, range);
  }

  showDataAtRange(editor, range) {
    range = Range.fromObject(range);

    if (this.lastExpandRange && this.lastExpandRange.isEqual(range)) {
      return Promise.resolve();
    }

    this.lastExpandRange = range;

    if (range.isEmpty()) {
      this.emptyData();
      return Promise.resolve();
    }

    return Plan.queryPlan()
    .then(() => DataLoader.getReportDataAtRange(editor, range))
    .then(([hover, report]) => {
      // if (report) { this.addFakeUsageData(report); }

      // console.log(JSON.stringify(hover, null, 2));
      // console.log(JSON.stringify(report, null, 2));
      if (hover.symbol && hover.symbol.length) {
        this.setData([hover, report]);
      } else {
        this.emptyData();
      }
    });
  }

  showDataForId(editor, id) {
    return Plan.queryPlan()
    .then(() => DataLoader.getValueReportDataForId(id))
    .then((report) => {
      this.setData([null, report]);
    });
  }

  createLinkScheme() {
    const scheme = new LinkScheme('kite-atom-internal', this);
    this.subscriptions.add(scheme);
    this.subscriptions.add(scheme.onDidClickLink(({url, target}) => {
      metrics.track('Expand UI link clicked');
      const {host, path} = url;
      switch (host) {
        case 'goto': {
          const [file, row] = path.split(':');
          atom.workspace.open(decodeURI(file)).then(editor =>
            editor.setCursorBufferPosition([
              parseInt(row, 10) - 1, 0,
            ], {
              autoscroll: true,
            }));
          metrics.track('Expand UI go to file clicked');
          break;
        }
        case 'members-list': {
          const id = path.replace(/^\//, '');
          const key = `${id}.*`;

          if (this.breadcrumb.includes(key)) {
            this.goto(key);
          } else {
            DataLoader.getMembersDataForId(id)
            // DataLoader.getValueReportDataForId(id)
            // .then(data => data.value.detail)
            .then(data => {
              const element = new KiteMembersList();
              element.setData(data);

              this.stack(key, element);
            })
            .catch(this.invalidateLink(target));
          }
          metrics.track('Expand UI See all members clicked');

          break;
        }
        case 'type':
        case 'value':
        case 'member': {
          const id = path.replace(/^\//, '').replace(/;/g, '.');

          this.stackDataForId(id, target);
          metrics.track(`Expand UI ${host} link clicked`);

          break;
        }
        case 'examples-list': {
          const id = path.replace(/^\//, '');
          const key = `${id} examples`;

          if (this.breadcrumb.includes(key)) {
            this.goto(key);
          } else {
            DataLoader.getValueReportDataForId(id)
            .then(data => {
              const element = new KiteExamplesList();
              element.setData(data);

              this.stack(key, element);
            })
            .catch(this.invalidateLink(target));
          }

          metrics.track('Expand UI See all examples clicked');

          break;
        }
        case 'links-list': {
          const id = path.replace(/^\//, '');
          const key = `${id} links`;

          if (this.breadcrumb.includes(key)) {
            this.goto(key);
          } else {
            DataLoader.getValueReportDataForId(id)
            .then(data => {
              const element = new KiteLinksList();
              element.setData(data);

              this.stack(key, element);
            })
            .catch(this.invalidateLink(target));
          }

          metrics.track('Expand UI See all links clicked');

          break;
        }
        case 'example': {
          const id = path.replace(/^\//, '');
          DataLoader.getExampleDataForId(id)
          .then(data => {
            const element = new KiteCuratedExample();
            const key = truncate(data.title, 50);
            element.setData(data);

            this.stack(key, element);
          })
          .catch(err => Logger.error(err));

          metrics.track('Expand UI example link clicked');
          break;
        }
        case 'navigation-depth': {
          const step = path.replace(/^\//, '');
          if (step === 'previous') {
            metrics.track('Expand UI back button clicked');
            this.previous();
          } else if (step === 'next') {
            metrics.track('Expand UI forward button clicked');
            this.next();
          } else {
            metrics.track('Expand UI breadcrumb link clicked');
            this.goto(parseInt(step, 10));
          }
        }
      }
    }));
  }

  stackDataForId(id, link) {
    DataLoader.getValueReportDataForId(id)
    .then(data => {
      // this.addFakeUsageData(data);

      let element, label;
      const kind = data.value.kind;

      switch (kind) {
        case 'function':
          element = new KiteExpandFunction();
          label = data.value.repr;
          element.setData(data);
          break;
        case 'instance':
          element = new KiteExpandInstance();
          label = valueNameFromId(data.value);
          element.setData(data);
          break;
        case 'module':
        case 'type':
          element = new KiteExpandModule();
          label = data.value.repr;
          element.setData(data);
          break;
        default:
          element = document.createElement('pre');
          label = 'unknown';
          element.innerHTML = `<code>${JSON.stringify(data, null, 2)}</code>`;
      }

      this.stack(label, element);
    })
    .catch(this.invalidateLink(link));
  }

  invalidateLink(target) {
    return (err) => {
      target.classList.add('unreachable');
      const {path} = url.parse(target.getAttribute('href'));
      this.subscriptions.add( atom.tooltips.add(target, {
        title: `No results available for <code>${path.replace(/^\//, '')}</code>`,
        html: true,
        class: 'kite-tooltip',
        trigger: 'hover',
        delay: { show: 0, hide: 100 },
      }));
      this.subscriptions.add(new DisposableEvent(target, 'click', e => {
        e.preventDefault();
        e.stopImmediatePropagation();
        e.stopPropagation();
      }));

      const [tooltip] = atom.tooltips.tooltips.get(target);
      tooltip.show();

      throw err;
    };
  }

  addFakeUsageData(o) {
    o.report.usages = [
      {
        id: 'some.id',
        code: 'Counter.increment(x)',
        filename: __filename,
        line: 246,
        begin_bytes: 2,
        begin_runes: 2,
      },
    ];
  }
}

module.exports = NavigablePanel;
