'use strict';

let os, path, Emitter, StateController, AccountManager, Logger, Installation,
  Installer, DecisionMaker, Errors, Metrics, KiteLogin, Plan, parseJSON,
  promisifyReadResponse, promisifyRequest, localconfig, errors;

const ensureKiteDeps = () => {
  if (!StateController) {
    ({
      StateController, AccountManager, Logger, Installation, Installer, DecisionMaker, Errors, Metrics,
    } = require('kite-installer'));
    errors = Errors();
  }
};

const ensureUtils = () => {
  if (!promisifyRequest) {
    ({parseJSON, promisifyReadResponse, promisifyRequest} = require('./utils'));
  }
};

const ATTEMPTS = 30;
const INTERVAL = 2500;
const INVALID_PASSWORD = 6;
const PASSWORD_LESS_USER = 9;

class KiteApp {
  static get STATES() {
    ensureKiteDeps();
    return StateController.STATES;
  }

  constructor(kite) {
    if (!Emitter) { ({Emitter} = require('atom')); }
    this.emitter = new Emitter();
    this.kite = kite;
  }

  onDidGetState(listener) {
    return this.emitter.on('did-get-state', listener);
  }

  onDidChangeState(listener) {
    return this.emitter.on('did-change-state', listener);
  }

  onKiteReady(listener) {
    return this.emitter.on('kite-ready', listener);
  }

  onWillDownload(listener) {
    return this.emitter.on('will-download', listener);
  }

  onDidDownload(listener) {
    return this.emitter.on('did-download', listener);
  }

  onDidFailDownload(listener) {
    return this.emitter.on('did-fail-download', listener);
  }

  onDidSkipInstall(listener) {
    return this.emitter.on('did-skip-install', listener);
  }

  onWillInstall(listener) {
    return this.emitter.on('will-install', listener);
  }

  onDidInstall(listener) {
    return this.emitter.on('did-install', listener);
  }

  onDidFailInstall(listener) {
    return this.emitter.on('did-fail-install', listener);
  }

  onWillStart(listener) {
    return this.emitter.on('will-start', listener);
  }

  onDidStart(listener) {
    return this.emitter.on('did-start', listener);
  }

  onDidFailStart(listener) {
    return this.emitter.on('did-fail-start', listener);
  }

  onDidShowLogin(listener) {
    return this.emitter.on('did-show-login', listener);
  }

  onDidSubmitLogin(listener) {
    return this.emitter.on('did-submit-login', listener);
  }

  onDidShowLoginError(listener) {
    return this.emitter.on('did-show-login-error', listener);
  }

  onDidCancelLogin(listener) {
    return this.emitter.on('did-cancel-login', listener);
  }

  onDidResetPassword(listener) {
    return this.emitter.on('did-reset-password', listener);
  }

  onWillAuthenticate(listener) {
    return this.emitter.on('will-authenticate', listener);
  }

  onDidAuthenticate(listener) {
    return this.emitter.on('did-authenticate', listener);
  }

  onDidFailAuthenticate(listener) {
    return this.emitter.on('did-fail-authenticate', listener);
  }

  onDidGetUnauthorized(listener) {
    return this.emitter.on('did-get-unauthorized', listener);
  }

  onWillWhitelist(listener) {
    return this.emitter.on('will-whitelist', listener);
  }

  onDidWhitelist(listener) {
    return this.emitter.on('did-whitelist', listener);
  }

  onDidFailWhitelist(listener) {
    return this.emitter.on('did-fail-whitelist', listener);
  }

  onWillBlacklist(listener) {
    return this.emitter.on('will-blacklist', listener);
  }

  onDidBlacklist(listener) {
    return this.emitter.on('did-blacklist', listener);
  }

  onDidFailBlacklist(listener) {
    return this.emitter.on('did-fail-blacklist', listener);
  }

  reset() {
    delete this.previousState;
    delete this.ready;
  }

  dispose() {
    this.emitter.dispose();
  }

  connect() {
    ensureKiteDeps();
    if (!Plan) { Plan = require('./plan'); }

    return StateController.handleState().then(state => {
      if (state >= StateController.STATES.INSTALLED) {
        localStorage.setItem('kite.wasInstalled', true);
      }

      if (state >= StateController.STATES.REACHABLE) {
        AccountManager.initClient(
          StateController.client.hostname,
          StateController.client.port,
          ''
        );
      }

      this.emitter.emit('did-get-state', state);

      if (state !== this.previousState) {
        this.emitter.emit('did-change-state', state);
        this.previousState = state;

        if (state === StateController.STATES.AUTHENTICATED && !this.ready) {
          this.emitter.emit('kite-ready');
          this.ready = true;
        }
      }

      return state >= StateController.STATES.REACHABLE
        ? Plan.queryPlan().then(() => state) :
        state;
    });
  }

  installFlow() {
    ensureKiteDeps();

    const editor = {
      UUID: localStorage.getItem('metrics.userId'),
      name: 'atom',
    };
    const plugin = { name: 'kite' };
    const dm = new DecisionMaker(editor, plugin);

    const throttle = dm.shouldOfferKite('', 1000);
    const canInstall = StateController.canInstallKite();

    return Promise.all([throttle, canInstall]).then((values) => {

      AccountManager.initClient('kite.com', -1, true);

      const [variant] = values;

      Metrics.Tracker.name = 'atom';
      Metrics.Tracker.props = variant;
      Metrics.Tracker.props.lastEvent = event;

      this.showInstallFlow(variant);
    }, (err) => {
      Logger.error('rejected with data:', err);
    });
  }

  showInstallFlow(variant) {
    ensureKiteDeps();
    if (!errors) { errors = Errors(); }

    errors.trackUncaught();
    const installation = new Installation(variant);
    const installer = new Installer([
      this.getRootDirectory(atom.workspace.getActiveTextEditor()),
    ]);
    installer.init(installation.flow, () => {
      errors.ignoreUncaught();
    });
    const pane = atom.workspace.getActivePane();
    installation.flow.onSkipInstall(() => {
      this.emitter.emit('did-skip-install');
      errors.ignoreUncaught();
      pane.destroyActiveItem();
    });

    installation.flow.showCreateAccount();

    pane.addItem(installation, { index: 0 });
    pane.activateItemAtIndex(0);

    return installation;
  }

  install() {
    ensureKiteDeps();

    this.emitter.emit('will-download');
    return StateController.downloadKite({
      onDownload: () => this.emitter.emit('did-download'),
      onInstallStart: () => this.emitter.emit('will-install'),
    })
    .then(() => this.emitter.emit('did-install'))
    .catch(err => {
      switch (err.type) {
        case 'bad_status':
        case 'curl_error':
          this.emitter.emit('did-fail-download', err);
          break;
        default:
          this.emitter.emit('did-fail-install', err);
      }
      throw err;
    });
  }

  wasInstalledOnce() {
    return localStorage.getItem('kite.wasInstalled') === 'true';
  }

  start() {
    ensureKiteDeps();

    this.emitter.emit('will-start');
    return StateController.runKiteAndWait(ATTEMPTS, INTERVAL)
    .then(() => this.emitter.emit('did-start'))
    .catch(err => {
      this.emitter.emit('did-fail-start', err);
      throw err;
    });
  }

  startEnterprise() {
    ensureKiteDeps();

    this.emitter.emit('will-start');
    return StateController.runKiteEnterpriseAndWait(ATTEMPTS, INTERVAL)
    .then(() => this.emitter.emit('did-start'))
    .catch(err => {
      this.emitter.emit('did-fail-start', err);
      throw err;
    });
  }

  login() {
    if (!KiteLogin) { KiteLogin = require('./elements/kite-login'); }

    const login = new KiteLogin();
    const panel = atom.workspace.addModalPanel({item: login});

    this.emitter.emit('did-show-login', {login, panel});

    login.onDidCancel(() => panel.destroy());
    login.onDidResetPassword(() => {
      const url = `https://kite.com/account/resetPassword/request?email=${login.email}`;

      atom.applicationDelegate.openExternal(url);
      this.emitter.emit('did-reset-password');
      panel.destroy();
    });

    login.onDidSubmit((data) => {
      this.emitter.emit('did-submit-login');

      this.authenticate(data)
      .then(() => {
        panel.destroy();
      })
      .catch(err => {
        if (err.message === 'Passwordless Form') {
          login.passwordLessForm();
        } else {
          login.showError(err.message);
          this.emitter.emit('did-show-login-error');
        }
      });
    });
  }

  authenticate(data) {
    ensureKiteDeps();
    ensureUtils();

    this.emitter.emit('will-authenticate', data);
    return AccountManager.login(data)
    .then(resp => {
      Logger.logResponse(resp);
      switch (resp.statusCode) {
        case 200:
          this.emitter.emit('did-authenticate', data);
          break;
        case 400:
        case 401:
          return promisifyReadResponse(resp).then(data => {
            data = parseJSON(data);
            switch (data.code) {
              case INVALID_PASSWORD:
                throw new Error('Invalid Password');
              case PASSWORD_LESS_USER:
                throw new Error('Passwordless Form');
              default:
                this.emitter.emit('did-get-unauthorized');
                throw new Error('Unauthorized');
            }
          });
      }
      return resp;
    })
    .catch(err => {
      this.emitter.emit('did-fail-authenticate', err);
      throw err;
    });
  }

  whitelist(path) {
    ensureKiteDeps();

    this.emitter.emit('will-whitelist', path);
    return StateController.whitelistPath(path)
    .then(() => this.emitter.emit('did-whitelist', path))
    .catch(err => {
      err.path = path;
      this.emitter.emit('did-fail-whitelist', err);
      throw err;
    });
  }

  blacklist(path, noAction) {
    ensureKiteDeps();

    this.emitter.emit('will-blacklist', path);
    return StateController.blacklistPath(path, noAction)
    .then(() => this.emitter.emit('did-blacklist', path))
    .catch(err => {
      err.path = path;
      this.emitter.emit('did-fail-blacklist', err);
      throw err;
    });
  }

  saveUserID() {
    ensureKiteDeps();
    ensureUtils();

    return promisifyRequest(StateController.client.request({
      path: '/clientapi/user',
      method: 'GET',
    }))
    .then(resp => {
      Logger.logResponse(resp);
      if (resp.statusCode !== 200) {
        throw new Error('Unable to reach user endpoint');
      }
      return promisifyReadResponse(resp);
    })
    .then(data => {
      data = JSON.parse(data);
      if (data.id !== undefined) {
        if (!localconfig) { localconfig = require('./localconfig'); }
        localconfig.set('distinctID', data.id);
      }
    })
    .catch(err => {
      Logger.error('error saving user ID', err);
    });
  }

  getRootDirectory(editor) {
    if (!os) { os = require('os'); }
    if (!path) { path = require('path'); }

    const [projectPath] = atom.project.getPaths();
    const basepath = editor ? editor.getPath() || projectPath : projectPath;

    return basepath && path.relative(os.homedir(), basepath).indexOf('..') === 0
      ? path.parse(basepath).root
      : os.homedir();
  }

  hasSupportedFileOpen() {
    return atom.workspace.getTextEditors().some(this.isGrammarSupported);
  }

  hasActiveSupportedFile() {
    const editor = atom.workspace.getActiveTextEditor();
    return editor && this.isGrammarSupported(editor);
  }

  isGrammarSupported(editor) {
    return /\.py$/.test(editor.getPath() || '');
  }
}

module.exports = KiteApp;
