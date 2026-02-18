// SPDX-License-Identifier: MIT
pragma solidity ^0.8.20;

contract ChessLedger {
    struct GameRecord {
        address player;
        string gameId;
        string result;
        string moves;
        string engineColor;
        uint256 timestamp;
    }

    GameRecord[] public games;

    event GamePublished(
        uint256 indexed index,
        address indexed player,
        string gameId,
        string result
    );

    function publishGame(
        string calldata gameId,
        string calldata result,
        string calldata moves,
        string calldata engineColor
    ) external {
        uint256 idx = games.length;
        games.push(GameRecord({
            player: msg.sender,
            gameId: gameId,
            result: result,
            moves: moves,
            engineColor: engineColor,
            timestamp: block.timestamp
        }));
        emit GamePublished(idx, msg.sender, gameId, result);
    }

    function getGameCount() external view returns (uint256) {
        return games.length;
    }

    function getGame(uint256 index) external view returns (GameRecord memory) {
        require(index < games.length, "Index out of bounds");
        return games[index];
    }
}
