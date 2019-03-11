/* eslint-env mocha */
/* eslint prefer-arrow-callback: "off" */

'use strict';

const assert = require('./util/assert');
const consensus = require('../lib/protocol/consensus');
const Address = require('../lib/primitives/address');
const Script = require('../lib/script/script');
const Outpoint = require('../lib/primitives/outpoint');
const MTX = require('../lib/primitives/mtx');
const FullNode = require('../lib/node/fullnode');
const pkg = require('../lib/pkg');

if (process.browser)
  return;

const ports = {
  p2p: 49331,
  node: 49332,
  wallet: 49333
};

const node = new FullNode({
  network: 'regtest',
  apiKey: 'foo',
  walletAuth: true,
  memory: true,
  workers: true,
  plugins: [require('../lib/wallet/plugin')],
  port: ports.p2p,
  httpPort: ports.node,
  env: {
    'BCOIN_WALLET_HTTP_PORT': ports.wallet.toString()
  }});

const {NodeClient, WalletClient} = require('bclient');

const nclient = new NodeClient({
  port: ports.node,
  apiKey: 'foo'
});

const wclient = new WalletClient({
  port: ports.wallet,
  apiKey: 'foo'
});

let wallet = null;

const {wdb} = node.require('walletdb');

let addr = null;
let hash = null;

describe('HTTP', function() {
  this.timeout(15000);

  it('should open node', async () => {
    consensus.COINBASE_MATURITY = 0;
    await node.open();
    await nclient.open();
    await wclient.open();
  });

  it('should create wallet', async () => {
    const info = await wclient.createWallet('test');
    assert.strictEqual(info.id, 'test');
    wallet = wclient.wallet('test', info.token);
    await wallet.open();
  });

  it('should get info', async () => {
    const info = await nclient.getInfo();
    assert.strictEqual(info.network, node.network.type);
    assert.strictEqual(info.version, pkg.version);
    assert.typeOf(info.pool, 'object');
    assert.strictEqual(info.pool.agent, node.pool.options.agent);
    assert.typeOf(info.chain, 'object');
    assert.strictEqual(info.chain.height, 0);
  });

  it('should get wallet info', async () => {
    const info = await wallet.getInfo();
    assert.strictEqual(info.id, 'test');
    const acct = await wallet.getAccount('default');
    const str = acct.receiveAddress;
    assert.typeOf(str, 'string');
    addr = Address.fromString(str, node.network);
  });

  it('should fill with funds', async () => {
    const mtx = new MTX();
    mtx.addOutpoint(new Outpoint(consensus.ZERO_HASH, 0));
    mtx.addOutput(addr, 50460);
    mtx.addOutput(addr, 50460);
    mtx.addOutput(addr, 50460);
    mtx.addOutput(addr, 50460);

    const tx = mtx.toTX();

    let balance = null;
    wallet.once('balance', (b) => {
      balance = b;
    });

    let receive = null;
    wallet.once('address', (r) => {
      receive = r[0];
    });

    let details = null;
    wallet.once('tx', (d) => {
      details = d;
    });

    await wdb.addTX(tx);
    await new Promise(r => setTimeout(r, 300));

    assert(receive);
    assert.strictEqual(receive.name, 'default');
    assert.strictEqual(receive.type, 'pubkeyhash');
    assert.strictEqual(receive.branch, 0);
    assert(balance);
    assert.strictEqual(balance.confirmed, 0);
    assert.strictEqual(balance.unconfirmed, 201840);
    assert(details);
    assert.strictEqual(details.hash, tx.txid());
  });

  it('should get balance', async () => {
    const balance = await wallet.getBalance();
    assert.strictEqual(balance.confirmed, 0);
    assert.strictEqual(balance.unconfirmed, 201840);
  });

  it('should send a tx', async () => {
    const options = {
      rate: 10000,
      outputs: [{
        value: 10000,
        address: addr.toString(node.network)
      }]
    };

    const tx = await wallet.send(options);

    assert(tx);
    assert.strictEqual(tx.inputs.length, 1);
    assert.strictEqual(tx.outputs.length, 2);

    let value = 0;
    value += tx.outputs[0].value;
    value += tx.outputs[1].value;

    assert.strictEqual(value, 48190);

    hash = tx.hash;
  });

  it('should get a tx', async () => {
    const tx = await wallet.getTX(hash);
    assert(tx);
    assert.strictEqual(tx.hash, hash);
  });

  it('should generate new api key', async () => {
    const old = wallet.token.toString('hex');
    const result = await wallet.retoken(null);
    assert.strictEqual(result.token.length, 64);
    assert.notStrictEqual(result.token, old);
  });

  it('should get balance', async () => {
    const balance = await wallet.getBalance();
    assert.strictEqual(balance.unconfirmed, 199570);
  });

  it('should execute an rpc call', async () => {
    const info = await nclient.execute('getblockchaininfo', []);
    assert.strictEqual(info.blocks, 0);
  });

  it('should execute an rpc call with bool parameter', async () => {
    const info = await nclient.execute('getrawmempool', [true]);
    assert.deepStrictEqual(info, {});
  });

  it('should create account', async () => {
    const info = await wallet.createAccount('foo1');
    assert(info);
    assert(info.initialized);
    assert.strictEqual(info.name, 'foo1');
    assert.strictEqual(info.accountIndex, 1);
    assert.strictEqual(info.m, 1);
    assert.strictEqual(info.n, 1);
  });

  it('should create account', async () => {
    const info = await wallet.createAccount('foo2', {
      type: 'multisig',
      m: 1,
      n: 2
    });
    assert(info);
    assert(!info.initialized);
    assert.strictEqual(info.name, 'foo2');
    assert.strictEqual(info.accountIndex, 2);
    assert.strictEqual(info.m, 1);
    assert.strictEqual(info.n, 2);
  });

  it('should get a block template', async () => {
    const json = await nclient.execute('getblocktemplate', [{
      rules: ['segwit']
    }]);
    assert.deepStrictEqual(json, {
      capabilities: ['proposal'],
      mutable: ['time', 'transactions', 'prevblock'],
      version: 536870912,
      rules: ['!segwit'],
      vbavailable: {},
      vbrequired: 0,
      height: 1,
      previousblockhash:
        '0f9188f13cb7b2c71f2a335e3a4fc328bf5beb436012afca590b1a11466e2206',
      target:
        '7fffff0000000000000000000000000000000000000000000000000000000000',
      bits: '207fffff',
      noncerange: '00000000ffffffff',
      curtime: json.curtime,
      mintime: 1296688603,
      maxtime: json.maxtime,
      expires: json.expires,
      sigoplimit: 80000,
      sizelimit: 4000000,
      weightlimit: 4000000,
      longpollid:
        '0f9188f13cb7b2c71f2a335e3a4fc328bf5beb436012afca590b1a11466e2206'
        + '00000000',
      submitold: false,
      coinbaseaux: { flags: '6d696e65642062792062636f696e' },
      coinbasevalue: 5000000000,
      transactions: [],
      default_witness_commitment:
        '6a24aa21a9ede2f61c3f71d1defd3fa999dfa36953755c690689799962b48beb'
        + 'd836974e8cf9'
    });
  });

  it('should send a block template proposal', async () => {
    const attempt = await node.miner.createBlock();
    const block = attempt.toBlock();
    const hex = block.toRaw().toString('hex');
    const json = await nclient.execute('getblocktemplate', [{
      mode: 'proposal',
      data: hex
    }]);
    assert.strictEqual(json, null);
  });

  it('should validate an address', async () => {
    const json = await nclient.execute('validateaddress', [
      addr.toString(node.network)
    ]);
    assert.deepStrictEqual(json, {
      isvalid: true,
      address: addr.toString(node.network),
      scriptPubKey: Script.fromAddress(addr).toRaw().toString('hex'),
      ismine: false,
      iswatchonly: false
    });
  });

  for (const template of [true, false]) {
    const suffix = template ? 'with template' : 'without template';
    it(`should create and sign transaction ${suffix}`, async () => {
      const change = await wallet.createChange('default');
      const tx = await wallet.createTX({
        template: template, // should not matter, sign = true
        sign: true,
        outputs: [{
          address: change.address,
          value: 50000
        }]
      });
      const mtx = MTX.fromJSON(tx);

      for (const input of tx.inputs) {
        const script = input.script;

        assert.notStrictEqual(script, '',
          'Input must be signed.');
      }

      assert.strictEqual(mtx.verify(), true,
        'Transaction must be signed.');
    });
  }

  it('should create transaction without template', async () => {
    const change = await wallet.createChange('default');
    const tx = await wallet.createTX({
      sign: false,
      outputs: [{
        address: change.address,
        value: 50000
      }]
    });

    for (const input of tx.inputs) {
      const script = input.script;

      assert.strictEqual(script.length, 0,
        'Input must not be templated.');
    }
  });

  it('should create transaction with template', async () => {
    const change = await wallet.createChange('default');
    const tx = await wallet.createTX({
      sign: false,
      template: true,
      outputs: [{
        address: change.address,
        value: 20000
      }]
    });

    for (const input of tx.inputs) {
      const script = Buffer.from(input.script, 'hex');

      // p2pkh
      // 1 (OP_0 placeholder) + 1 (length) + 33 (pubkey)
      assert.strictEqual(script.length, 35);
      assert.strictEqual(script[0], 0x00,
        'First item in stack must be a placeholder OP_0');
    }
  });

  it('should cleanup', async () => {
    consensus.COINBASE_MATURITY = 100;
    await wallet.close();
    await wclient.close();
    await nclient.close();
    await node.close();
  });
});
