// Project imports
var BotPlayer = require('./BotPlayer');
var FakeSocket = require('./FakeSocket');
var PacketHandler = require('../PacketHandler');

function BotLoader(gameServer) {
this.gameServer = gameServer;

    // Names
    this.randomNames = ["Bacteria","Spore","Satanist","Earth","Nazi","Moon","Poland","sanik","ayy lmao","Reddit","CIA","wojak","doge","sir","facepunch","8","Russia","Circle","Blob","4chan","Mars","Ogar","NASA","Helper","Parasite","Square","Round","Bug","Splitting","Ice","Japan","irs"];
    this.nameIndex = 0;
}

module.exports = BotLoader;

BotLoader.prototype.getName = function() {
    var name = "";

    // Picks a random name for the bot
    if (this.randomNames.length > 0) {
        var index = Math.floor(Math.random() * this.randomNames.length);
        name = this.randomNames[index];
        this.randomNames.splice(index,1);
    } else {
        name = "bot" + ++this.nameIndex;
    }

    return name;
};

BotLoader.prototype.addBot = function() {
    var s = new FakeSocket(this.gameServer);
    s.playerTracker = new BotPlayer(this.gameServer, s);
    s.packetHandler = new PacketHandler(this.gameServer, s);

    // Add to client list
    this.gameServer.clients.push(s);

    // Add to world
    s.packetHandler.setNickname(this.getName());
};

