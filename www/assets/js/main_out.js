(function(wHandle, wjQuery) {
    if (navigator.appVersion.indexOf("MSIE") != -1)
	   alert("You're using a pretty old browser, some parts of the website might not work properly.");

    Date.now || (Date.now = function() {
        return (+new Date).getTime();
    });
    Array.prototype.remove = function(a) {
        let i = this.indexOf(a);
        if (i !== -1) {
            this.splice(i, 1);
            return true;
        }
        return false;
    };
    Array.prototype.peek = function() {
        return this[this.length - 1];
    };
    var CONNECT_TO,
        SKIN_URL = "./skins/",
        USE_HTTPS = "https:" == wHandle.location.protocol,
        BORDER_DEFAULT = {
            top: -2E3,
            left: -2E3,
            right: 2E3,
            bottom: 2E3
        },
        PI_2 = Math.PI * 2,
        SEND_254 = new Uint8Array([254, 6, 0, 0, 0]),
        SEND_255 = new Uint8Array([255, 1, 0, 0, 0]),
        UINT8_CACHE = {
            1: new Uint8Array([1]),
            17: new Uint8Array([17]),
            21: new Uint8Array([21]),
            18: new Uint8Array([18]),
            19: new Uint8Array([19]),
            22: new Uint8Array([22]),
            23: new Uint8Array([23]),
            24: new Uint8Array([24]),
            254: new Uint8Array([254])
        }
        FPS_MAXIMUM = 1000,
        ws = null,
        disconnectDelay = 1;

    function Disconnect() {
        if (!ws) return;
        ws.onopen = null;
        ws.onmessage = null;
        ws.onerror = null;
        ws.onclose = null;
        ws.close();
        if (serverStatID) {
            clearInterval(serverStatID);
            serverStatID = null;
        }
        ws = null;
        resetGameVariables();
    }

    function resetGameVariables() {
        nodesID = { };
        nodes = [];
        myNodes = [];
        deadNodes = [];
        leaderboard = [];
        leaderboardType = "none";
        userScore = 0;
        centerX = 0;
        centerY = 0;
        lastMessageTime = -1;
        latency = Infinity;
        _cX = 0;
        _cY = 0;
        _cZoom = 1;
        mapCenterSet = false;
        border = BORDER_DEFAULT;
        knownSkins = [];
        loadedSkins = [];
        viewZoom = 1;
        userName = "";
        chatText = "";
        gameType = -1;
        serverVersion = "Unknown";
        serverStats = null;
        leaderboardCanvas = null;
        serverStatCanvas = null;
    }

    function Connect(to) {
        if (ws) Disconnect();
        wjQuery("#connecting").show();
        ws = new WebSocket((USE_HTTPS ? "wss://" : "ws://") + (CONNECT_TO = to));
        ws.binaryType = "arraybuffer";
        ws.onopen = WsOpen;
        ws.onmessage = WsMessage;
        ws.onerror = WsError;
        ws.onclose = WsClose;
        log.debug("Connecting to " + to);
    }

    function WsOpen() {
        disconnectDelay = 1;
        wjQuery("#connecting").hide();
        WsSend(SEND_254);
        WsSend(SEND_255);
        serverVersion = "Unknown";
        log.debug("Connected to " + CONNECT_TO);
        log.debug("HTTPS: " + USE_HTTPS);
        chatMessages.push({
            server: false,
            admin: false,
            mod: false,
            nameColor: "#33BB33",
            name: "Cigar",
            message: "Connected to " + CONNECT_TO,
            time: Date.now()
        });
        lastMessageTime = Date.now();
        drawChat();
    }

    function WsMessage(data) {
        var reader = new Reader(new DataView(data.data), 0, true),
            i, count,
            packet = reader.getUint8();
        switch (packet) {
            case 0x20:
                // New cell of mine
                myNodes.push(reader.getUint32());
                break;
            case 0x63:
                // Chat message
                var flags = reader.getUint8(),
                    name, message, nameColor;

                var r = reader.getUint8(),
                    g = reader.getUint8(),
                    b = reader.getUint8(),
                    nameColor = (r << 16 | g << 8 | b).toString(16);
                while (nameColor.length < 6) nameColor = '0' + nameColor;
                nameColor = '#' + nameColor;
                name = reader.getStringUTF8();
                message = reader.getStringUTF8();
                chatAlphaWait += Math.max(2000, 1000 + message.length * 100);
                chatMessages.push({
                    server: !!(flags & 0x80),
                    admin: !!(flags & 0x40),
                    mod: !!(flags & 0x20),
                    nameColor: nameColor,
                    name: name,
                    message: message,
                    time: Date.now()
                });
                drawChat();
                break;
            case 0x12:
                // Clear all
                for (var i in nodesID) nodesID[i].destroy(Date.now());
            case 0x14:
                // Clear nodes (case 0x12 slips here too)
                myNodes = [];
                break;
            case 0x15:
                // Draw line
                // Unimplemented
                break;
            case 0xFE:
                // Server stat
                serverStats = JSON.parse(reader.getStringUTF8());
                latency = Date.now() - lastMessageTime;
                drawServerStat();
                break;
            case 0x40:
                // Set border
                border.left = reader.getFloat64();
                border.top = reader.getFloat64();
                border.right = reader.getFloat64();
                border.bottom = reader.getFloat64();
                if (data.data.byteLength !== 33) {
                    // Game type and server name is given
                    gameType = reader.getUint32();
                    serverVersion = reader.getStringUTF8();
                    if (/MultiOgar/.test(serverVersion) && !serverStatID) {
                        serverStatID = setInterval(function() {
                            // Server stat
                            lastMessageTime = Date.now();
                            WsSend(UINT8_CACHE[254]);
                        }, 2000);
                    }
                }

                if (0 === myNodes.length && !mapCenterSet) {
                    mapCenterSet = true;
                    _cX = (border.right + border.left) / 2;
                    _cY = (border.bottom + border.top) / 2;
                    centerX = _cX;
                    centerY = _cY;
                }
                break;
            // Leaderboard update packets
            case 0x30:
                // Text list, somewhat deprecated
                leaderboard = [];
                if (leaderboardType != 0x30) {
                    leaderboardType = 0x30;
                    log.info("Got somewhat deprecated leaderboard type 48 (0x30). Server-side is possibly Ogar")
                }

                count = reader.getUint32();
                for (i = 0; i < count; ++i)
                    leaderboard.push(reader.getStringUTF8());
                drawLeaderboard();
                break;
            case 0x31:
                // FFA list
                leaderboard = [];
                leaderboardType = 0x31;
                count = reader.getUint32();
                for (i = 0; i < count; ++i) {
                    leaderboard.push({
                        me: reader.getUint32(),
                        name: reader.getStringUTF8() || "An unnamed cell"
                    });
                }
                drawLeaderboard();
                break;
            case 0x32:
                // Pie chart
                leaderboard = [];
                leaderboardType = 0x32;
                count = reader.getUint32();
                for (i = 0; i < count; ++i)
                    leaderboard.push(reader.getFloat32());
                drawLeaderboard();
                break;
            case 0x10:
                // Update nodes
                var killer, killed, id, node, x, y, size, flags,
                    updColor, updName, updSkin, // Flags
                    time = Date.now();

                // Consume records
                count = reader.getUint16();
                for (var i = 0; i < count; i++) {
                    killer = reader.getUint32();
                    killed = reader.getUint32();
                    if (!nodesID.hasOwnProperty(killer) || !nodesID.hasOwnProperty(killed)) continue;
                    nodesID[killed].killer = nodesID[killer];
                    nodesID[killed].destroy();
                }

                // Node update records
                while (1) {
                    id = reader.getUint32();
                    if (0 === id) break;

                    x = reader.getInt32();
                    y = reader.getInt32();
                    size = reader.getUint16();

                    flags = reader.getUint8();
                    updColor = !!(flags & 0x02);
                    updName = !!(flags & 0x08);
                    updSkin = !!(flags & 0x04);
                    var color = null,
                        name = null,
                        skin = null,
                        tmp = "";

                    if (updColor) {
                        color = "";
                        for (var r = reader.getUint8(), g = reader.getUint8(), b = reader.getUint8(),
                            color = (r << 16 | g << 8 | b).toString(16); 6 > color.length;) color = "0" + color;
                        color = "#" + color;
                    }

                    if (updSkin) skin = reader.getStringUTF8();
                    if (updName) name = reader.getStringUTF8();

                    if (nodesID.hasOwnProperty(id)) {
                        node = nodesID[id];
                        node.nx = x;
                        node.ny = y;
                        node.nSize = size;
                        updColor && (node.setColor(color));
                        updName && (node.setName(name));
                        updSkin && (node.skin = skin);
                        node.updateStamp = time;
                    } else {
                        node = new Cell(id, x, y, size, name || "", color || "#FFFFFF", skin || "", time, flags);
                        nodesID[id] = node;
                        nodes.push(node);
                    }
                }

                // Dissapear records
                count = reader.getUint16();
                for (i = 0; i < count; i++) {
                    killed = reader.getUint32();
                    if (nodesID.hasOwnProperty(killed)) nodesID[killed].destroy(time);
                }

                // List through cells and if it wasn't updated mark it as pellet
                count = nodes.length;
                for (i = 0; i < count; i++) {
                    node = nodes[i];

                    if (node.isPellet || node.notPellet || node.isVirus || node.isAgitated || node.isEjected) continue;
                    if (node.updateStamp !== time && node.birthStamp !== time) {
                        // Node is a pellet - draw cache
                        var _nCache = document.createElement('canvas');
                        var pCtx = _nCache.getContext('2d'),
                            lW = this.nSize > 20 ? Math.max(this.nSize * .01, 10) : 0, sz;
                        _nCache.width = (sz = node.nSize + lW) * 2;
                        _nCache.height = sz * 2;
                        pCtx.lineWidth = lW;
                        pCtx.lineCap = pCtx.lineJoin = "round";
                        pCtx.fillStyle = node.color;
                        pCtx.strokeStyle = node.strokeColor;

                        pCtx.beginPath();
                        pCtx.arc(sz, sz, node.nSize - lW, 0, 2 * Math.PI, false);
                        pCtx.fill();
                        pCtx.stroke();
                        pCtx.closePath();
                        node._meCache = _nCache;
                        node._meW = _nCache.width / 2;
                        node._meH = _nCache.height / 2;
                        node.isPellet = true;
                    } else if (node.updateStamp === time && node.birthStamp !== time)
                        // Not a pellet
                        node.notPellet = true;
                }
                break;
            case 0x11:
                // Update position (spectate packet)
                _cX = reader.getFloat32();
                _cY = reader.getFloat32();
                _cZoom = reader.getFloat32();
                break;
            default:
                log.err("Got unexpected packet ID " + packet)
                Disconnect();
        }
    }

    function WsError(e) {
        log.warn("Connection error");
        log.debug(e);
    }

    function WsClose() {
        log.debug("Disconnected");
        Disconnect();
        setTimeout(function() {
            if (ws) if (ws.readyState === 1) return;
            Connect(CONNECT_TO);
        }, (disconnectDelay *= 1.5) * 1000);
    }

    function WsSend(data) {
        if (!ws) return;
        if (ws.readyState !== 1) return; // Still connecting
        if (data.build) ws.send(data.build());
        else ws.send(data);
    }

    function Play(name) {
        log.debug("Playing");
        var writer = new Writer(true);
        writer.setUint8(0x00);
        writer.setStringUTF8(name);
        userName = name;
        WsSend(writer);
    }

    function SendChat(a) {
        if (a.length > 200) {
            chatMessages.push({
                server: false,
                admin: false,
                mod: false,
                nameColor: "#FF0000",
                name: "Cigar",
                message: "Too large message!",
                time: Date.now()
            });
            drawChat();
            return;
        }
        if (log.VERBOSITY === 3) {
            var s = a.split(' '),
                v = s[0].toLowerCase();
            if (v[0] === "/") {
                if (v === "/dev") {
                    chatMessages.push({
                        server: false,
                        admin: false,
                        mod: false,
                        nameColor: "#1671CC",
                        name: "Cigar",
                        message: "Dev commands",
                        time: Date.now()
                    }, {
                        server: false,
                        admin: false,
                        mod: false,
                        nameColor: "#1671CC",
                        name: "Cigar",
                        message: "/connect - connect to some other IP",
                        time: Date.now()
                    }, {
                        server: false,
                        admin: false,
                        mod: false,
                        nameColor: "#1671CC",
                        name: "Cigar",
                        message: "/setsetting - Set a graphics option",
                        time: Date.now()
                    });
                } else if (v === "/connect") {
                    Connect(s[1]);
                } else if (v === "/setsetting") {
                    settings[s[2]] = s[3];
                }
                drawChat();
                return;
            }
        }
        var writer = new Writer();
        writer.setUint8(0x63);
        writer.setUint8(0);
        writer.setStringUTF8(a);
        WsSend(writer);
    }

    function SendMouseMove(x, y) {
        var writer = new Writer(true);
        writer.setUint8(0x10);
        writer.setUint32(x);
        writer.setUint32(y);
        writer._b.push(0, 0, 0, 0);
        WsSend(writer);
    }

    // Game variables
    var nodesID = { },
        nodes = [],
        deadNodes = [],
        myNodes = [],
        leaderboard = [],
        leaderboardType = -1, // -1 - Not set, 48 - Text list, 49 - FFA list, 50 - Pie chart
        leaderboardCanvas = null,
        userScore = 0,
        centerX = 0,
        centerY = 0,
        _cX = 0, _cY = 0, _cZoom = 1, // Spectate packet X, Y & zoom
        mapCenterSet = false,
        rawMouseX = 0,
        rawMouseY = 0,
        border = BORDER_DEFAULT,
        knownSkins = [],
        loadedSkins = [],
        drawZoom = 1,  // Scale when drawing
        viewZoom = 1,  // Scale without scroll scaling
        mouseZoom = 1, // Scroll scale
        lastMessageTime = -1,
        latency = Infinity,
        drawing = false,
        userName = "",
        // Red Green Blue Yellow Cyan Magenta Orange
        teamColors = ["#FF3333", "#33FF33", "#3333FF", "#FFFF33", "#33FFFF", "#FF33FF", "#FF8833"],
        gameType = -1; // Given at SetBorder packet
        serverVersion = "Unknown", // Given at SetBorder packet
        chatText = "",
        chatMessages = [],
        chatAlphaWait = 0,
        chatCanvas = null,
        isTyping = false,
        isWindowFocused = true,
        mainCanvas = null,
        mainCtx = null,
        chatBox = null,
        lastDrawTime = Date.now(),
        escOverlay = false,
        fps = 0,
        serverStatID = null,
        serverStats = null,
        serverStatCanvas = null,
        pressed = {
            space: false,
            w: false,
            e: false,
            r: false,
            t: false,
            p: false,
            q: false,
            esc: false
        };

    // Client variables
    var settings = {
        touchable: 'createTouch' in document,
        showMass: false,
        showNames: true,
        showLeaderboard: true,
        showChat: true,
        showGrid: true,
        showColor: true,
        showSkins: true,
        darkTheme: false,
        fastRenderMax: 0.4,
        maxScore: 0
    };

    // Load local storage
    if (null != wHandle.localStorage) {
        wjQuery(window).load(function() {
            wjQuery(".save").each(function() {
                var id = $(this).data("box-id");
                var value = wHandle.localStorage.getItem("checkbox-" + id);
                if (value && value == "true" && 0 != id) {
                    $(this).prop("checked", "true");
                    $(this).trigger("change");
                } else if (id == 0 && value != null) {
                    $(this).val(value);
                }
            });
            wjQuery(".save").change(function() {
                var id = $(this).data('box-id');
                var value = (id == 0) ? $(this).val() : $(this).prop('checked');
                wHandle.localStorage.setItem("checkbox-" + id, value);
            });
        });
    }

    // Load known skin list
    wjQuery.ajax({
        type: "POST",
        dataType: "json",
        url: "checkdir.php",
        data: {
            "action": "getSkins"
        },
        success: function(data) {
            response = JSON.parse(data["names"]);
            for (var i = 0; i < response.length; i++) {
                if (-1 == knownSkins.indexOf(response[i])) {
                    knownSkins.push(response[i]);
                }
            }
        }
    });

    function hideESCOverlay() {
        escOverlay = false;
        wjQuery("#overlays").hide();
    }

    function showESCOverlay(arg) {
        escOverlay = true;
        userNickName = null;
        wjQuery("#overlays").fadeIn(350);
    }

    function loadInit() {
        mainCanvas = document.getElementById('canvas');
        mainCtx = mainCanvas.getContext('2d');
        chatBox = document.getElementById("chat_textbox");
        mainCanvas.focus();
        // wHandle functions
        function handleWheel(event) {
            mouseZoom *= Math.pow(.9, event.wheelDelta / -120 || event.detail || 0);
            1 > mouseZoom && (mouseZoom = 1);
            mouseZoom > 4 / viewZoom && (mouseZoom = 4 / viewZoom);
        }
        // Mouse wheel
        if (/firefox/i.test(navigator.userAgent)) {
            document.addEventListener("DOMMouseScroll", handleWheel, false);
        } else {
            document.body.onmousewheel = handleWheel;
        }
        window.onfocus = function() {
            isWindowFocused = true;
        }
        window.onblur = function() {
            isWindowFocused = false;
        }
        wHandle.onkeydown = function(event) {
            switch (event.keyCode) {
                case 13: // enter
                    if (isTyping && settings.showChat) {
                        chatBox.blur();
                        var chattxt = chatBox.value;
                        if (chattxt.length > 0) SendChat(chattxt);
                        chatBox.value = "";
                    } else if (settings.showChat) chatBox.focus();
                    break;
                case 32: // space
                    if (isTyping) break;
                    WsSend(UINT8_CACHE[17]);
                    break;
                case 87: // W
                    if (isTyping) break;
                    WsSend(UINT8_CACHE[21]);
                    break;
                case 81: // Q
                    if (isTyping) break;
                    WsSend(UINT8_CACHE[18]);
                    break;
                case 69: // E
                    if (isTyping) break;
                    WsSend(UINT8_CACHE[22]);
                    break;
                case 82: // R
                    if (isTyping) break;
                    WsSend(UINT8_CACHE[23]);
                    break;
                case 84: // T
                    if (isTyping) break;
                    WsSend(UINT8_CACHE[24]);
                    break;
                case 80: // P
                    if (isTyping) break;
                    WsSend(UINT8_CACHE[25]);
                    break;
                case 27: // esc
                    if (pressed.esc) break;
                    pressed.esc = true;
                    if (escOverlay) hideESCOverlay();
                    else showESCOverlay();
                    break;
            }
        };
        wHandle.onkeyup = function(event) {
            switch (event.keyCode) {
                case 32: // space
                    pressed.space = false;
                    break;
                case 87: // W
                    pressed.w = false;
                    break;
                case 81: // Q
                    if (pressed.q) WsSend(UINT8_CACHE[19]);
                    pressed.q = false;
                    break;
                case 69: // E
                    pressed.e = false;
                    break;
                case 82: // R
                    pressed.r = false;
                    break;
                case 84: // T
                    pressed.t = false;
                    break;
                case 80: // P
                    pressed.p = false;
                    break;
                case 27:
                    pressed.esc = false;
                    break;
            }
        }
        chatBox.onblur = function() {
            isTyping = false;
            drawChat();
        };
        chatBox.onfocus = function() {
            isTyping = true;
            drawChat();
        };
        mainCanvas.onmousemove = function(event) {
            rawMouseX = event.clientX;
            rawMouseY = event.clientY;
        };
        setInterval(function() {
            // Mouse update
            SendMouseMove((rawMouseX - mainCanvas.width / 2) / drawZoom + centerX,
                (rawMouseY - mainCanvas.height / 2) / drawZoom + centerY);
        }, 40);
        wHandle.onresize = canvasResize;
        canvasResize();
        log.info("Loaded, took " + (Date.now() - LOAD_START) + " ms");
        if (window.requestAnimationFrame)
            window.requestAnimationFrame(drawLoop);
        else
            setInterval(drawGame, 1E3 / FPS_MAXIMUM);
        showESCOverlay();
    }

    function getChatAlpha() {
        if (isTyping) return true;
        var now = Date.now(),
            lastMsg = chatMessages.peek(),
            diff = now - lastMsg.time;

        return 1 - Math.min(Math.max((diff - chatAlphaWait) * .001, 0), 1);
    }

    function drawChat() {
        if (!settings.showChat || chatMessages.length === 0) return;
        if (!chatCanvas) chatCanvas = document.createElement('canvas');

        var ctx = chatCanvas.getContext('2d'),
            l,
            now = Date.now(),
            i = 0, msg,
            lastMsg = chatMessages.peek(),
            fW, aW = 0,
            alpha = getChatAlpha();

        if (alpha === 0) {
            chatCanvas = null;
            chatAlphaWait = 0;
            return;
        }

        while ((l = chatMessages.length) > 15) chatMessages.shift(); // Remove older messages

        for ( ; i < l; i++) {
            msg = chatMessages[i];
            ctx.font = '18px Ubuntu';
            aW = Math.max(aW, 20 + ctx.measureText(msg.name + ":").width + ctx.measureText(" " + msg.message).width);
        }

        chatCanvas.width = aW;
        chatCanvas.height = l * 20 + 20;
        ctx.fillStyle = "#000000";
        ctx.globalAlpha = alpha * .2;
        ctx.fillRect(0, 0, chatCanvas.width, chatCanvas.height);

        ctx.globalAlpha = alpha;
        for (i = 0; i < l; i++) {
            msg = chatMessages[i];

            // Name
            ctx.fillStyle = msg.nameColor;
            ctx.font = '18px Ubuntu';
            fW = ctx.measureText(msg.name + ":").width;
            ctx.font = '18px Ubuntu';
            ctx.fillText(msg.name + ":", 10, 5 + 20 * (i + 1));

            // Message
            ctx.font = '18px Ubuntu';
            ctx.fillStyle = "#FFFFFF";
            ctx.fillText(" " + msg.message, 10 + fW, 5 + 20 * (i + 1));
        }
    }

    function drawServerStat() {
        if (!serverStats) {
            serverStatCanvas = null;
            return;
        }

        if (!serverStatCanvas) serverStatCanvas = document.createElement('canvas');
        var ctx = serverStatCanvas.getContext('2d'), a, b, c;

        ctx.font = '14px Ubuntu';
        serverStatCanvas.width = 4 + Math.max(
            ctx.measureText(serverStats.name).width,
            ctx.measureText(serverStats.mode).width,
            ctx.measureText((a = serverStats.playersTotal + " / " + serverStats.playersLimit + " players")).width,
            ctx.measureText((b = serverStats.playersAlive + " playing")).width,
            ctx.measureText((c = serverStats.playersSpect + " spectating")).width
        );
        serverStatCanvas.height = 85;

        ctx.font = '14px Ubuntu';
        ctx.fillStyle = settings.darkTheme ? "#AAAAAA" : "#000000";
        ctx.globalAlpha = 1;
        ctx.fillText(serverStats.name, 2, 16);
        ctx.fillText(serverStats.mode, 2, 32);
        ctx.fillText(a, 2, 48);
        ctx.fillText(b, 2, 64);
        ctx.fillText(c, 2, 80);
    }

    function drawLeaderboard() {
        if (leaderboardType === -1) return;
        if (!leaderboardCanvas) leaderboardCanvas = document.createElement('canvas');

        var ctx = leaderboardCanvas.getContext('2d'),
            l = leaderboard.length;
            ctxScale = Math.min(0.22 * mainCanvas.height, Math.min(200, .3 * mainCanvas.width)) * 0.005,
            width = leaderboardType !== 50 ? 60 + 24 * l : 240,
            i = 0;

        leaderboardCanvas.width = 200 * ctxScale;
        leaderboardCanvas.height = width * ctxScale;

        ctx.scale(ctxScale, ctxScale);
        ctx.globalAlpha = .4;
        ctx.fillStyle = "#000000";
        ctx.fillRect(0, 0, 200, width);

        ctx.globalAlpha = 1;
        ctx.fillStyle = "#FFFFFF";
        ctx.font = "30px Ubuntu";
        ctx.fillText("Leaderboard", 100 - ctx.measureText("Leaderboard").width / 2, 40);

        if (leaderboardType === 0x32) {
            // Pie chart
            ctx.beginPath();
            var last = 0;
            for ( ; i < l; i++) {
                ctx.fillStyle = teamColors[i];
                ctx.moveTo(100, 140);
                ctx.arc(100, 140, 80, last, (last += leaderboard[i] * PI_2), false);
                ctx.fill();
            }
            ctx.closePath();
        } else {
            // Text-based
            var o, me = false, w, start;
            ctx.font = "20px Ubuntu";
            for ( ; i < l; i++) {
                o = leaderboard[i];
                if (leaderboardType === 0x31) {
                    me = o.me;
                    o = o.name;
                }
                ctx.fillStyle = me ? "#FFAAAA" : "#FFFFFF";
                o = (i + 1) + ". " + o;
                var start = ((w = ctx.measureText(o).width) > 200) ? 2 : 100 - w * 0.5;
                ctx.fillText(o, start, 70 + 24 * i);
            }
        }
    }

    function drawGrid() {
        mainCtx.save();
        mainCtx.strokeStyle = settings.darkTheme ? "#AAAAAA" : "#000000";
        mainCtx.globalAlpha = .2;
        var step = 50,
            cW = mainCanvas.width / drawZoom, cH = mainCanvas.height / drawZoom,
            startLeft = (-centerX + cW * .5) % step,
            startTop = (-centerY + cH * .5) % step,
            i = startLeft;

        mainCtx.scale(drawZoom, drawZoom);

        // Left -> Right
        for ( ; i < cW; i += step) {
            mainCtx.moveTo(i, -.5);
            mainCtx.lineTo(i, cH);
        }

        // Top -> Bottom
        for (i = startTop; i < cH; i += step) {
            mainCtx.moveTo(-.5, i);
            mainCtx.lineTo(cW, i);
        }
        mainCtx.stroke();
        mainCtx.restore();
    }

    function drawLoop() {
        drawGame(true);
        window.requestAnimationFrame(drawLoop);
    }

    function drawGame(normal) {
        if (normal) {
            var dr = Date.now(), passed;
            fps += (1000 / (passed = dr - lastDrawTime) - fps) * .1;
            lastDrawTime = dr;
        }

        var cW = mainCanvas.width = wHandle.innerWidth,
            cH = mainCanvas.height = wHandle.innerHeight,
            cW2 = cW / 2,
            cH2 = cH / 2,
            newDrawZoom = 0,
            viewMult = viewMultiplier(),
            i, l = myNodes.length, n, newScore = 0;

        // Zoom, position & score update
        if (l > 0) {
            var ncX = 0,
                ncY = 0;
            var rl = 0;
            viewZoom = 0;
            for (i = 0; i < l; i++) {
                n = nodesID[myNodes[i]];
                if (!n) continue;
                viewZoom += n.size;
                newScore += ~~(n.nSize * n.nSize * .01);
                ncX += n.x;
                ncY += n.y;
                rl++;
            }
            if (rl > 0) {
                userScore = Math.max(newScore, userScore);
                ncX /= rl;
                ncY /= rl;
                centerX += (ncX - centerX) * .4;
                centerY += (ncY - centerY) * .4;
                viewZoom = Math.pow(Math.min(64 / viewZoom, 1), .4);
                newDrawZoom = viewZoom;
            } else {
                // Cells haven't been added yet
                viewZoom = 1;
                newDrawZoom = 1;
            }
        } else {
            centerX += (_cX - centerX) * .02;
            centerY += (_cY - centerY) * .02;
            newDrawZoom = _cZoom;
        }
        drawZoom += (newDrawZoom * viewMult * mouseZoom - drawZoom) * .11;
        drawing = true;

        // Background
        mainCtx.save();
        mainCtx.fillStyle = settings.darkTheme ? "#111111" : "#F2FBFF";
        mainCtx.fillRect(0, 0, cW, cH);
        mainCtx.restore();

        var tx, ty, z1;

        // Grid
        if (settings.showGrid) drawGrid();

        // Scale & translate for cell drawing
        mainCtx.translate((tx = cW2 - centerX * drawZoom + .5), (ty = cH2 - centerY * drawZoom + .5));
        mainCtx.scale(drawZoom, drawZoom);

        var a = nodes.concat(deadNodes);
        a.sort(nodeSort);

        // Draw cells
        l = a.length;
        for (i = 0; i < l; i++) {
            n = a[i];
            n.draw(dr);
        }

        // Return back to normal
        mainCtx.scale((z1 = 1 / drawZoom), z1);
        mainCtx.translate(-tx, -ty);

        mainCtx.save();
        mainCtx.fillStyle = settings.darkTheme ? "#F2FBFF" : "#111111";
        // Score & FPS drawing
        if (userScore > 0) {
            mainCtx.font = "32px Ubuntu";
            mainCtx.fillText("Score: " + userScore, 2, 34);
            mainCtx.font = "20px Ubuntu";
            mainCtx.fillText(~~fps + " FPS, " + latency + " ping", 2, 58);
            serverStatCanvas && mainCtx.drawImage(serverStatCanvas, 2, 60);
        } else {
            mainCtx.font = "20px Ubuntu";
            mainCtx.fillText(~~fps + " FPS, " + latency + " ping", 2, 22);
            serverStatCanvas && mainCtx.drawImage(serverStatCanvas, 2, 24);
        }
        mainCtx.restore();
        leaderboardCanvas && mainCtx.drawImage(leaderboardCanvas, cW - leaderboardCanvas.width - 10, 10);

        // Chat alpha update
        if (chatMessages.length > 0) if (getChatAlpha() !== 1) drawChat();
        chatCanvas && mainCtx.drawImage(chatCanvas, 10, cH - 50 - chatCanvas.height);

        drawing = false;

        collectTextGarbage();
    }

    function nodeSort(a, b) {
        return a.size === b.size ? a.id - b.id : a.size - b.size;
    }

    function viewMultiplier() {
        return Math.max(mainCanvas.height / 1080, mainCanvas.width / 1920);
    }

    function canvasResize() {
        window.scrollTo(0, 0);
        mainCanvas.width = wHandle.innerWidth;
        mainCanvas.height = wHandle.innerHeight;
    }

    function Cell(id, x, y, size, name, color, skin, time, flags) {
        this.id = id;
        this.x = this.nx = x;
        this.y = this.ny = y;
        this.size = this.nSize = size;
        this.setName(name, 1);
        this.setColor(color);
        this.skin = skin;
        if (flags) {
            this.isEjected = !!(flags & 0x20);
            this.isVirus = !!(flags & 0x01);
            this.isAgitated = !!(flags & 0x10);
            (this.isEjected || this.isVirus || this.isAgitated) && (this.notPellet = true);
        }
        this.birthStamp = this.updateStamp = time;
    }

    Cell.prototype = {
        destroyed: false,
        id: 0,
        x: 0,
        y: 0,
        size: 0,
        name: 0,
        color: "#FFFFFF",
        skin: "",
        updateStamp: -1,
        birthStamp: -1,
        deathStamp: -1,
        appStamp: -1,
        _ts: -1,
        nx: 0,
        ny: 0,
        nSize: 0,
        killer: null,
        rigidPoints: [],
        isEjected: false,
        isPellet: false,
        notPellet: false,
        isVirus: false,
        isAgitated: false,
        strokeColor: "#AAAAAA",
        _nameSize: 0,
        _meCache: null, // If it's a pellet it'll draw from this cache
        _meW: null,
        _meH: null,
        _nameTxt: null,
        _massTxt: null,
        updateAppearance: function(time, dt) {
            if (this.destroyed)
                if (time - this.deathStamp > 200 || !this.killer || this.size < 4) {
                    // Fully remove
                    deadNodes.remove(this);
                }
            if (this.killer) {
                this.nx = this.killer.x;
                this.ny = this.killer.y;
                this.nSize = 0;
            }
            this.x += (this.nx - this.x) * dt;
            this.y += (this.ny - this.y) * dt;
            this.size += (this.nSize - this.size) * dt;
            this._nameSize = ~~(Math.max(~~(.3 * this.size), 24) / 4) * 4;
        },
        setName: function(name) {
            this.name = name;
        },
        getNameSize: function() {
            return this._nSize;
        },
        setColor: function(color) {
            this.color = color;
            var r = (~~(parseInt(color.substr(1, 2), 16) * 0.9)).toString(16),
                g = (~~(parseInt(color.substr(3, 2), 16) * 0.9)).toString(16),
                b = (~~(parseInt(color.substr(5, 2), 16) * 0.9)).toString(16);
            if (r.length == 1) r = "0" + r;
            if (g.length == 1) g = "0" + g;
            if (b.length == 1) b = "0" + b;
            this.strokeColor = "#" + r + g + b;
        },
        destroy: function(time) {
            delete nodesID[this.id];
            nodes.remove(this);
            if (myNodes.remove(this.id) && myNodes.length === 0) {
                _cX = centerX;
                _cY = centerY;
                _cZoom = viewZoom;
                userScore = 0;
                showESCOverlay();
            }
            deadNodes.push(this);
            this.deathStamp = time;
            this.destroyed = true;
        },
        updatePoints: function(animated, jagged, dt) {
            // Update points
            var pointAmount = jagged ? (this.size * .9) : this.size * drawZoom,
                minPointAmount = jagged ? 90 : (this.isPellet ? 5 : 16),
                x = this.x,
                y = this.y,
                i = 0, p, sz, step, pt, avg;

            this.notPellet && (pointAmount *= .5);
            this.isEjected && (pointAmount *= .5);
            pointAmount = Math.max(~~pointAmount, minPointAmount);
            jagged && (pointAmount = ~~(pointAmount * .5) * 2);

            var newPoints = [];
            for ( ; i < pointAmount; i++) {
                var nDiff;
                if (this.rigidPoints[i] && animated) {
                    // Animate the point
                    pt = this.rigidPoints[i];
                    nDiff = pt.newDiff;
                    p = pt.diff + (nDiff - pt.diff) * dt;
                    if (toleranceCompare(p, nDiff, .05)) nDiff = getNextDiff(jagged, i, pointAmount, animated);
                } else if (animated) {
                    // New point
                    nDiff = getNextDiff(jagged, i, pointAmount, animated);
                    p = 0;
                } else {
                    // Non-animated point
                    p = nDiff = getNextDiff(jagged, i, pointAmount, animated);
                }
                sz = this.size + p;
                step = PI_2 / pointAmount;

                newPoints.push({
                    size: sz,
                    diff: p,
                    newDiff: nDiff,
                    x: x + Math.sin(i * step) * sz,
                    y: y + Math.cos(i * step) * sz
                });
            }

            this.rigidPoints = newPoints;
        },
        draw: function(time) {
            var dt = Math.min(Math.max((time - this.appStamp) / 120, 0), 1);
            this.updateAppearance(time, dt);
            this.appStamp = time;

            mainCtx.save();
            this.drawShape(dt);

            // Text drawing
            if (this.notPellet) {
                var nameDraw = settings.showNames && this.name !== "" && !this.isVirus;
                if (nameDraw) drawText(this.x, this.y, this.name, this._nameSize, "#FFFFFF", true, "#000000");

                if (settings.showMass && (myNodes.indexOf(this.id) !== -1 || myNodes.length === 0) && this.size >= 20) {
                    var text = ~~(this.size * this.size * .01);
                    if (nameDraw)
                        drawText(this.x, this.y + this.size * .2, text, this._nameSize * .5, "#FFFFFF", true, "#000000");
                    else
                        drawText(this.x, this.y, text, this._nameSize * .5, "#FFFFFF", true, "#000000");
                }
            }
            mainCtx.restore();
        },
        drawShape: function(dt) {
            var complex = settings.fastRenderMax <= drawZoom,
                jagged = this.isVirus;

            mainCtx.lineWidth = this.isEjected ? 0 : this.size > 20 ? Math.max(this.size * .01, 10) : 0;
            mainCtx.lineCap = "round";
            mainCtx.lineJoin = jagged ? "miter" : "round";
            mainCtx.fillStyle = this.color;
            mainCtx.strokeStyle = this.strokeColor;

            if (complex || jagged || this.isAgitated) {
                mainCtx.beginPath();
                this.updatePoints(complex, jagged, dt);
                var points = this.rigidPoints;

                mainCtx.lineTo(
                    points[0].x,
                    points[0].y
                );

                for (var i = 1, l = points.length; i < l; i++) {
                    mainCtx.lineTo(
                        points[i].x,
                        points[i].y
                    );
                }

                mainCtx.lineTo(
                    points[0].x,
                    points[0].y
                );
                mainCtx.fill();
                mainCtx.stroke();
                mainCtx.closePath();
            } else {
                if (this._meCache)
                    // Cached drawing exists - use it
                    mainCtx.drawImage(this._meCache, this.x - this.size, this.y - this.size, this.size * 2, this.size * 2);
                else {
                    mainCtx.beginPath();
                    mainCtx.arc(this.x, this.y, this.size - mainCtx.lineWidth * 0.5 + 1, 0, PI_2, false);
                    mainCtx.fill();
                    mainCtx.stroke();
                    mainCtx.closePath();
                }
            }
        }
    };

    function toleranceCompare(a, b, t) {
        var d = a - b;
        (d < 0) && (d = -d);
        return d <= t;
    }

    function getNextDiff(jagged, index, pointAmount, animated) {
        if (animated) {
            var maxDiff = jagged ? 3 : 1.7 / drawZoom * .6;
            if (jagged) return (index % 2 === 1 ? -maxDiff : maxDiff) + Math.random() - 1.5;
            return (Math.random() - .5) * maxDiff * 2;
        }
        if (jagged) return index % 2 === 1 ? -3 : 3;
        return 0;
    }

    var textCache = { };

    function collectTextGarbage() {
        var now = Date.now();
        for (var i in textCache) {
            for (var j in textCache[i]) {
                if (now - textCache[i][j].accessTime > 3000) {
                    // Text unused for 3 seconds, delete it to restore memory
                    delete textCache[i][j];
                    if (Object.keys(textCache[i]).length === 0) delete textCache[i]; // Full removal
                }
            }
        }
    }

    function newTextCache(value, size, color, stroke, strokeColor) {
        var canvas = document.createElement('canvas'),
            ctx = canvas.getContext('2d'),
            lineWidth = size * .1;

        // Why set font twice???
        ctx.font = size + 'px Ubuntu';
        canvas.width = (ctx.measureText(value).width + lineWidth) + 3;
        canvas.height = size + lineWidth;
        ctx.font = size + 'px Ubuntu';
        ctx.fillStyle = color || "#FFFFFF";
        ctx.lineWidth = lineWidth;
        ctx.strokeStyle = strokeColor || "#000000";

        stroke && ctx.strokeText(value, (lineWidth *= .5), size * .9);
        ctx.fillText(value, lineWidth, size * .9);

        (!textCache[value]) && (textCache[value] = { });
        textCache[value][size] = {
            canvas: canvas,
            color: color,
            stroke: stroke,
            strokeColor: strokeColor,
            accessTime: Date.now()
        };
        return canvas;
    }

    function findMatch(value, size, color, stroke, strokeColor) {
        if (!textCache[value]) return newTextCache(value, size, color, stroke, strokeColor); // No text with equal string

        var tolerance = ~~(size * .1),
            b;

        if ((b = textCache[value][size])) {
            // Same style check
            if (b.color === color && b.stroke === stroke && b.strokeColor === strokeColor) {
                b.accessTime = Date.now();
                return b.canvas;
            }
        }

        // Search with identical sized text
        for (var i = 1; i < tolerance; i++) {
            // Larger text sizes are better
            if ((b = textCache[value][size + i])) {
                // Same style check
                if (b.color === color && b.stroke === stroke && b.strokeColor === strokeColor) {
                    b.accessTime = Date.now();
                    return b.canvas;
                }
            }
            // In any case check for smaller size too
            if ((b = textCache[value][size - i])) {
                if (b.color === color && b.stroke === stroke && b.strokeColor === strokeColor) {
                    b.accessTime = Date.now();
                    return b.canvas;
                }
            }
        }

        // No match
        return newTextCache(value, size, color, stroke, strokeColor);
    }

    function drawText(x, y, value, size, color, stroke, strokeColor, isMass) {
        var identical = findMatch(value, size, color, stroke, strokeColor),
            w = identical.width,
            h = identical.height;

        mainCtx.drawImage(identical, x - w * .5, y - h * .5, w, h);
    }

    wHandle.setserver = function(arg) {
        if (CONNECT_TO != arg) {
            Disconnect();
            Connect(CONNECT_TO = arg);
        }
    };
    wHandle.setDarkTheme = function(a) {
        settings.darkTheme = a;
        drawServerStat();
    };
    wHandle.setShowMass = function(a) {
        alert("Showing mass will make your RAM skyrocket to extreme amounts due to text caching. An update to fix this will come soon.");
        settings.showMass = a;
    };
    wHandle.setSkins = function(a) {
        settings.showSkins = a;
    };
    wHandle.setColors = function(a) {
        settings.showColor = a;
    };
    wHandle.setNames = function(a) {
        settings.showNames = a;
    };
    wHandle.setSmooth = function(a) {
        settings.fastRenderMax = a ? 1 : 0.4;
    };
    wHandle.setChatHide = function(a) {
        settings.showChat = a;
    };
    wHandle.spectate = function(a) {
        WsSend(UINT8_CACHE[1]);
        userScore = 0;
        hideESCOverlay();
    };
    wHandle.play = function(a) {
        Play(a);
        hideESCOverlay();
    }

    wHandle.onload = loadInit;
})(window, window.jQuery);
