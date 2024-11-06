import {
    BlockfrostProvider,
    MeshWallet,
    MeshTxBuilder,
    Transaction,
    serializePlutusScript,
    conStr,
    byteString,
    scriptAddress,
    serializeAddressObj,
    resolveScriptHash,
    stringToHex
} from '@meshsdk/core'
import cbor from 'cbor'

import fs from 'node:fs'

import { findUTXOWithSpecificUnit } from "./util.mjs"

const blockfrostKey = fs.readFileSync(`var/blockfrost.api-key`).toString().trim()
const blockchainProvider = new BlockfrostProvider(blockfrostKey)

const leftHex = process.argv[2]
const rightHex = process.argv[3]
const multiSigPubKeyHashHex = process.argv[4]

console.log(`Left ${leftHex}`);
console.log(`Right ${rightHex}`);
console.log(`Committee hash ${multiSigPubKeyHashHex}`);

const validatorBlueprint = JSON.parse(
  fs.readFileSync('./var/sky-bridge-validator.json')
)

const validator = {
  code: cbor
    .encode(
      Buffer.from(validatorBlueprint.validators[0].compiledCode, 'hex')
    )
    .toString('hex'),
  version: 'V2'
}

const validatorAddress = serializePlutusScript(validator).address

const mintingPolicyBlueprint = JSON.parse(
  fs.readFileSync('./var/sky-minting-policy.json')
)

const mintingPolicy = {
  code: cbor
    .encode(
      Buffer.from(mintingPolicyBlueprint.validators[0].compiledCode, 'hex')
    )
    .toString('hex'),
  version: 'V2'
}

const mintingPolicyHash = resolveScriptHash(
  mintingPolicy.code,
  mintingPolicy.version
)

const bridgeUtxos = await blockchainProvider.fetchAddressUTxOs(validatorAddress);
const nft = findUTXOWithSpecificUnit(bridgeUtxos, mintingPolicyHash + stringToHex('SkyBridge'))

const bountyBlueprint = JSON.parse(
  fs.readFileSync('./var/sky-bounty-validator.json')
)

const bountyValidator = {
  code: cbor
    .encode(
      Buffer.from(bountyBlueprint.validators[0].compiledCode, 'hex')
    )
    .toString('hex'),
  version: 'V2'
}

const bountyAddress = serializePlutusScript(bountyValidator).address
const bountyUtxos = await blockchainProvider.fetchAddressUTxOs(bountyAddress);
const bountyUtxo = bountyUtxos[0] // TBD for now claim only one of the UTXOs at bounty
console.log(JSON.stringify(bountyUtxo))

// ClientRedeemer
const redeemer = {
    alternative: 0,
    fields: [
	// SimplifiedMerkleProof
	{ alternative: 0,
	  fields: [
	      // DataHash
	      { alternative: 0, fields: [ leftHex ] },
	      // DataHash
	      { alternative: 0, fields: [ rightHex ] }
	  ]
	},
	// DataHash
	{ alternative: 0, fields: [ multiSigPubKeyHashHex ] }
    ]
}

const wallet = new MeshWallet({
  networkId: 0,
  fetcher: blockchainProvider,
  submitter: blockchainProvider,
  key: {
    type: 'root',
    bech32: fs.readFileSync('./var/cla2.skey').toString().trim()
  }
})

const recipient = {
    address: fs.readFileSync('./var/cla2.addr').toString().trim()
};

const tx = new Transaction({ initiator: wallet, verbose: true })
      .redeemValue({
	  value: bountyUtxo,
	  script: bountyValidator,
	  redeemer: { data: redeemer }
      })
      .sendValue(recipient, bountyUtxo)
      .setTxRefInputs([ nft ]);

const unsignedTx = await tx.build();
const signedTx = await wallet.signTx(unsignedTx);
const txHash = await wallet.submitTx(signedTx);

console.log("OK: tx: " + txHash)
