import type { Credential } from '../store.ts';
import { daysAgo } from '../lib/ids.ts';

/**
 * Seeded credentials for the demo dataset. Every seeded account shares one
 * password so the sign-in screen can offer a one-click demo entry; the hashes
 * are scrypt with a per-user salt and are generated, never hand-written.
 *
 * A real deployment does not ship passwords in the database like this — it
 * authenticates against an identity provider and stores nothing.
 */
export const DEMO_PASSWORD = 'Demo#2026!';

export const credentials: Credential[] = [
  { userId: 'u_buyer1', hash: '100a1d5081caabf4283bfa518b2562dd:70d2ac2eaf7635d098a1d52de3ad5637a15bf0ba4597f4e551d4a7da35a6ba8b14359eee2423cbed19c7441c9a13857232e76e42fd0371750f4d08d81400d3ca', updatedAt: daysAgo(420) },
  { userId: 'u_buyer2', hash: '3775181307dbb1f5a4f35185fb572382:e2a9ef7e9ce8b27c7fd6a2b8ddc67ab788049b71078864705a3da8c740bcdc3e95b0febb1d018b359c53f9508ea723fe17af1f527be2696f96e6a507b90ab18f', updatedAt: daysAgo(180) },
  { userId: 'u_b2b1', hash: '004755aa6ea89c03d9ad353c8bc75da0:c78ee8a30682f102841f4ed9d4911aef5d06fdc7ade867b8e0b0bf8dfa5c916f4e96e0e36b7ca02d94c1090a195143d6fb914cbc70cbc784fcd321971c1b1066', updatedAt: daysAgo(300) },
  { userId: 'u_b2b2', hash: '662cb6fdc1faf5011412f2b93b367958:1bad0d4ae3e32f295e70cc94b24f0b19f82086ae932c615bc25883a4289796416a2292120317d4c57d76271b2eec1b2d803df4ec8d7eb1c641a0b9ec1e7d3343', updatedAt: daysAgo(210) },
  { userId: 'u_seller1', hash: '17fdb9d9c302907176b00aa03b1b300f:975f3da76cd6f622fc515f83603402d9085e7cad243790d0dc06d4b9f54dc87d40b9194d724ad0d50a302854f71e601af4cd8ec6bd8a23013d086678b4733617', updatedAt: daysAgo(500) },
  { userId: 'u_seller2', hash: '8912a2d963ce7c50cc583d9d9e0a4268:29f54feb75e4ec87c41f0f8bb2ba6a1a117e46cf4e515f3ecbc24157238d2513ff9277fe7ce5e2c344c85ab194e93ff0129113a3963faefbf771699ed3f3c7eb', updatedAt: daysAgo(430) },
  { userId: 'u_seller3', hash: 'd393dae9362da941b4b748d12f37d197:8273dbe63cea56fd478753f62c0aa0f54d906c8be6c7b24d49a1d84bbcaf3b5fa34a1688ec6c3d7fc1d74e207b08fc812099f7e983c0a7f1ce6e5a91300b0ac7', updatedAt: daysAgo(280) },
  { userId: 'u_seller4', hash: 'c4bb7eac0e2b6eb8f0b7500e3e38effb:5b818e4a029eddd2c146a5d5a218761ed1bd3f7850beee61b4b22ed6a0824ab415356c0583c2d6a2fd56c624869e9db03ce86860550e157d7debe7a86b144a0a', updatedAt: daysAgo(690) },
  { userId: 'u_seller5', hash: '5237a62e9bc471786c066d58213c0954:c14afc7f5779e4ba2d1de7e337071d2e19337344444d28310e3f770111bcaf73787c85c94827f2c1cc07b2709179e9b4976a8e8603718612a27ebe8e8d669e58', updatedAt: daysAgo(115) },
  { userId: 'u_agent1', hash: '8f871fa1dd6e968ddb90c4861e7c8a2d:ab7b4a7ee529a384c55d95b2321977f925c4e102849cfbefd1c979c6f6b05912cd49e4724c35b2707aff59e52f6b9f123cae71b5e62f7078becc73cd5de1454f', updatedAt: daysAgo(150) },
  { userId: 'u_agent2', hash: '7a66feb3924689969132649f6a700f74:37ee6674ca42f680a5a97a51af6e21169daa7eb56630916ab7b7c63eca0472ea0760b7b041e1da13497137c3b10c0953abf26f0b9559ae5f09bd0ba53d2f4987', updatedAt: daysAgo(90) },
  { userId: 'u_admin1', hash: 'f7ef4dce05ebc5372b887f727e323c0a:3509f25c88d8e59f9222b48d63b300ff82eccc8198b88fe2bc132ab73f6499ef4541c7fa9be3782d99d383c06932fc7223df53451af03b7b1b0d3c2c9f16d0cb', updatedAt: daysAgo(600) },
  { userId: 'u_finance1', hash: '047d3c675b8c7fa9bea0005dc7b4e89c:5ce4af02d4319f98471c17e26a98f12f29c3cad8e19f3a03e617858f2b38cd352be4e5723fee0574f2937771ac5fdbfff5fd4f4fb8f74e0c994761f797e69a0f', updatedAt: daysAgo(540) },
  { userId: 'u_new1', hash: '3cc2df0cb956940bc381e7d1853dc53a:57e1a5522104170a670dea9af8607b059aa1beb117ea4eae6e328ec24f1f52959d207416252c4001a900c255aed4e535c8e2bec342cd8dcdeb611b00dfbb3d7a', updatedAt: daysAgo(9) },
  { userId: 'u_new2', hash: '765299d6482962df9554f413b5ab7319:714a8a85775d627b9d90911d2ba56835f7c9617c1a0611d5169b757b32a165bfcfd965c9f5c4e334436d05ee1271359a014c804791a1bc2afa5c4e77b8d08fcf', updatedAt: daysAgo(4) },
];
