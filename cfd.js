module.exports = function (RED) {
 
    function cfdConfig(n) {
        RED.nodes.createNode(this, n);
        this.name = n.name;
        this.token = n.token;
        this.url = n.url;
        this.test = n.test;
    }

    function CloudflaredNode(config) {
        RED.nodes.createNode(this, config);
        const node = this;
        const { Tunnel } = require("cloudflared");
        
        const globalContext = node.context().global;
        let tunnelProcess = globalContext.get(`tunnelProcess_${node.id}`);
        let checkInterval = globalContext.get(`checkInterval_${node.id}`);
        let lastCheckTime = globalContext.get(`lastCheckTime_${node.id}`) || Date.now();
        let isTunnelDisconnected = globalContext.get(`isTunnelDisconnected_${node.id}`) || false;
        

        async function startTunnel() {
            if (tunnelProcess) {
                tunnelProcess.removeAllListeners();
            }

            try {
                node.status({ fill: "yellow", shape: "dot", text: "starting tunnel..." });
        
                const configNode = RED.nodes.getNode(config.token);
                const token = configNode ? configNode.token : "";
                const url = configNode && configNode.url.trim() !== "" ? configNode.url : "http://localhost:1880";
        
                if (configNode.test === true) {
                    // Si "test" es true, iniciar el quickTunnel en modo hello-world
                    node.log("Starting tunnel in test mode (hello-world)...");
                    tunnelProcess = await Tunnel.quick();
                } else {
                    // Si "test" es false, revisa el valor de "token"
                    if (token === "") {
                        // Si token está vacío, inicia el quickTunnel con la URL proporcionada (o localhost por defecto)
                        node.log(`Starting tunnel with URL: ${url}`);
                        tunnelProcess = await Tunnel.quick(url);
                    } else {
                        // Si token tiene un valor, inicia el túnel con el token
                        node.log(`Starting tunnel with token: ${token}`);
                        tunnelProcess = await Tunnel.withToken(token);
                    }
                }

                const globalContext = node.context().global;
                let tunnelList = globalContext.get("tunnelList") || [];
        
                tunnelList = tunnelList.filter(nodeInfo => nodeInfo.id !== node.id);
                tunnelList.push({
                    node_id: node.id
                });
        
                globalContext.set("tunnelList", tunnelList);
                globalContext.set(`tunnelProcess_${node.id}`, tunnelProcess);

                let receivedRelevantStderr = false; 
                let parsedData = {};

                // Escuchar los eventos de stderr
                tunnelProcess.on("stderr", (output) => {
                    
                    if (output.includes("Generated Connector ID")) {
                        const match = output.match(/Connector ID: ([a-f0-9-]+)/i);
                        if (match && match[1]) {
                            parsedData.connectorId = match[1];
                            receivedRelevantStderr = true;
                        }
                    }

                    if (output.includes("context canceled")) {
                        const eventMatch = output.match(/context canceled/i);
                        if (eventMatch) {
                            stopTunnel();
                        }
                    }

                    if (output.includes("Starting metrics server on")) {
                        const match = output.match(/Starting metrics server on (\d+\.\d+\.\d+\.\d+:\d+)/);
                        if (match && match[1]) {
                            parsedData.metricsServerUrl = `http://${match[1]}/metrics`;
                            receivedRelevantStderr = true;
                        }
                    }

                    if (output.includes("Initial protocol")) {
                        const protocolMatch = output.match(/Initial protocol (\w+)/i);
                        if (protocolMatch && protocolMatch[1]) {
                            parsedData.initialProtocol = protocolMatch[1];
                        }
                    }

                    if (output.includes("ingress")) {
             
                        const cleanedOutput = output.replace(/\\"/g, '"'); 
                    
                        const match = cleanedOutput.match(/"hostname":"([^"]+)"/);
                    
                        if (match && match[1]) {
                            const hostname = match[1];
                            const managedUrl = `https://${hostname}`;
                            const globalContext = node.context().global;
                    
                            let tunnelList = globalContext.get("tunnelList") || [];
                    
                            const tunnelIndex = tunnelList.findIndex(tunnel => tunnel.node_id === node.id);
                            if (tunnelIndex !== -1) {
                                tunnelList[tunnelIndex].public_url = managedUrl;
                                tunnelList[tunnelIndex].local_url = "managed at cf";
                            } else {
                                tunnelList.push({
                                    node_id: node.id,
                                    public_url: managedUrl,
                                    local_url: "managed at cf"
                                });
                            }

                            node.send({
                                payload: {
                                    tunnelCreated: managedUrl,
                                    exposedUrl: "managed at cf"
                                }
                            });

                            globalContext.set("tunnelList", tunnelList);
                        } else {
                            node.warn("Invalid hostname");
                        }
                    }

                    if (output.includes("Your quick Tunnel has been created! Visit it at")) {
                        const cleanedOutput = output.replace(/\\"/g, '"');
                        const match = cleanedOutput.match(/https:\/\/[a-zA-Z0-9.-]+\.trycloudflare\.com/);
                    
                        if (match && match[0]) {
                            const publicUrl = match[0];
                            const globalContext = node.context().global;
                    
                            let tunnelList = globalContext.get("tunnelList") || [];
                    
                            const tunnelIndex = tunnelList.findIndex(tunnel => tunnel.node_id === node.id);
                            if (tunnelIndex !== -1) {
                                tunnelList[tunnelIndex].public_url = publicUrl;
                                tunnelList[tunnelIndex].local_url = url;
                            } else {
                                tunnelList.push({
                                    node_id: node.id,
                                    public_url: publicUrl,
                                    local_url: url
                                });
                            }
                    
                            node.send({
                                payload: {
                                    tunnelCreated: publicUrl,
                                    exposedUrl: url
                                }
                            });

                            globalContext.set("tunnelList", tunnelList);
                        } else {
                            node.warn("Failed to extract quick tunnel URL.");
                        }
                    }

                });



                tunnelProcess.on("connected", (connection) => {

                    const waitForStderr = setInterval(() => {
                        if (receivedRelevantStderr) {
                            clearInterval(waitForStderr);

                            const enhancedConnection = {
                                ...connection,
                                ...parsedData
                            };

                            node.status({ fill: "green", shape: "dot", text: "tunnel active" });
                            node.send({
                                payload: {
                                    connection: enhancedConnection
                                }
                            });
                        }
                    }, 100);
                });
        
        

            } catch (err) {
                node.status({ fill: "red", shape: "ring", text: "error starting tunnel" });
                node.error(`Error starting tunnel: ${err.message}`);
            }
        }

        function stopTunnel() {
            if (tunnelProcess) {
                tunnelProcess.stop();
                tunnelProcess = null;
                
                const globalContext = node.context().global;
                
                let tunnelList = globalContext.get("tunnelList") || [];
                tunnelList = tunnelList.filter(nodeInfo => nodeInfo.node_id !== node.id);
                
                globalContext.set("tunnelList", tunnelList);
                globalContext.set(`tunnelProcess_${node.id}`, null);
                
                node.status({ fill: "red", shape: "ring", text: "tunnel stopped" });
                node.log("Tunnel stopped.");
            } else {
                node.warn("No active tunnel to stop.");
            }
        }
        
        function checkTunnelStatus() {
            const currentTime = Date.now();
            const elapsedTime = currentTime - lastCheckTime;

            if (!tunnelProcess || !tunnelProcess._process) {
                node.status({ fill: "red", shape: "dot", text: "disconnected" });
                if (!isTunnelDisconnected && elapsedTime > 60000) {
                    isTunnelDisconnected = true; // Marcar como desconectado después de 60 segundos
                }
                return;
            }

            const processState = tunnelProcess._process;

            try {
                process.kill(processState.pid, 0);

                node.status({ fill: "green", shape: "dot", text: "connected" });
                isTunnelDisconnected = false;
            } catch (err) {
                if (err.code === "ESRCH") {
                    node.status({ fill: "red", shape: "dot", text: "disconnected" });
                    node.warn("Tunnel process does not exist.");
                } else {
                    node.status({ fill: "yellow", shape: "ring", text: "error" });
                    node.error("Error checking tunnel process:", err);
                }

                if (!isTunnelDisconnected && elapsedTime > 60000) {
                    isTunnelDisconnected = true;
                }
            }

            lastCheckTime = currentTime;
            globalContext.set('lastCheckTime', lastCheckTime);
            globalContext.set('isTunnelDisconnected', isTunnelDisconnected);
        }

        function startStatusChecker() {
            if (!checkInterval) {
                checkTunnelStatus();
                checkInterval = setInterval(checkTunnelStatus, 5000);
                globalContext.set('checkInterval', checkInterval);
            }
        }

        function stopStatusChecker() {
            if (checkInterval) {
                clearInterval(checkInterval);
                checkInterval = null;
                globalContext.set('checkInterval', checkInterval);
            }
        }

        startStatusChecker();
        
    
        node.on("input", (msg) => {
            node.log(`Received message: ${JSON.stringify(msg)}`);
        
            const tunnelPayload = msg.payload?.tunnel;
        
            if (!tunnelPayload) {
                node.warn("No tunnel status provided in payload.");
                if (tunnelProcess) {
                    node.send({ payload: { url: tunnelProcess.url} });
                }
                return;
            }
        
            const { status } = tunnelPayload;
        
            switch (status) {
                case "on":
                    if (!tunnelProcess) {
                        startTunnel();
                    } else {
                        node.warn("Tunnel is already running.");
                        node.send({ payload: { url: tunnelProcess.url} });
                    }
                    break;
        
                case "off":
                    stopTunnel();
                    break;
        
                default:
                    node.warn("Invalid tunnel status received.");
                    if (tunnelProcess) {
                        node.send({ payload: { url: tunnelProcess.url} });
                    }
                    break;
            }
        });
    
        node.on("close", function (removed, done) {
            
            stopStatusChecker();
            
            if (removed) {
                stopTunnel();
            }

            done();
        });

    }

    RED.nodes.registerType("cloudflared", CloudflaredNode);
    RED.nodes.registerType("cfd-config", cfdConfig);

    RED.httpAdmin.post("/cloudflared/:id", RED.auth.needsPermission("inject.write"), function (req, res) {
        const node = RED.nodes.getNode(req.params.id);
        if (node != null) {
            try {

                const status = req.body.on === "true" ? "on" : "off";
                const payload = { payload: { tunnel: { status: status } } };
                
                node.receive(payload);
                res.sendStatus(200);
            } catch (err) {
                res.sendStatus(500);
                node.error(`Failed to handle HTTP command: ${err.message}`);
            }
        } else {
            res.sendStatus(404);
        }
    });
};