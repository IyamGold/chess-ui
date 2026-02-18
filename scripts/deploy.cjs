const hre = require("hardhat");

async function main() {
  const ChessLedger = await hre.ethers.getContractFactory("ChessLedger");
  const ledger = await ChessLedger.deploy();
  await ledger.waitForDeployment();
  const address = await ledger.getAddress();
  console.log("ChessLedger deployed to:", address);
}

main().catch((error) => {
  console.error(error);
  process.exitCode = 1;
});
