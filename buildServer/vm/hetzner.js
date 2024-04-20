"use strict";
var __importDefault = (this && this.__importDefault) || function (mod) {
    return (mod && mod.__esModule) ? mod : { "default": mod };
};
Object.defineProperty(exports, "__esModule", { value: true });
exports.Hetzner = void 0;
const config_1 = __importDefault(require("../config"));
const axios_1 = __importDefault(require("axios"));
const base_1 = require("./base");
const fs_1 = __importDefault(require("fs"));
const redis_1 = require("../utils/redis");
const HETZNER_TOKEN = config_1.default.HETZNER_TOKEN;
const sshKeys = config_1.default.HETZNER_SSH_KEYS.split(',').map(Number);
class Hetzner extends base_1.VMManager {
    constructor() {
        super(...arguments);
        this.size = 'cpx11'; // cx11, cpx11, cpx21, cpx31, ccx11
        this.largeSize = 'cpx31';
        this.minRetries = 5;
        this.reuseVMs = true;
        this.id = 'Hetzner';
        this.gateway = config_1.default.HETZNER_GATEWAY;
        this.imageId = config_1.default.HETZNER_IMAGE;
        this.startVM = async (name) => {
            const data = {
                name: name,
                server_type: this.isLarge ? this.largeSize : this.size,
                start_after_create: true,
                image: Number(this.imageId),
                ssh_keys: sshKeys,
                public_net: {
                    enable_ipv4: true,
                    enable_ipv6: false,
                },
                // networks: [
                //   this.networks[Math.floor(Math.random() * this.networks.length)],
                // ],
                // user_data: `replace with vbrowser.sh startup script if we want to boot vbrowser on instance creation (won't trigger on rebuild/restart)`
                labels: {
                    [this.getTag()]: '1',
                },
                location: this.getRandomDatacenter(),
            };
            const response = await (0, axios_1.default)({
                method: 'POST',
                url: `https://api.hetzner.cloud/v1/servers`,
                headers: {
                    Authorization: 'Bearer ' + HETZNER_TOKEN,
                    'Content-Type': 'application/json',
                },
                data,
            });
            const id = response.data.server.id;
            return id;
        };
        this.terminateVM = async (id) => {
            await (0, axios_1.default)({
                method: 'DELETE',
                url: `https://api.hetzner.cloud/v1/servers/${id}`,
                headers: {
                    Authorization: 'Bearer ' + HETZNER_TOKEN,
                },
            });
        };
        this.rebootVM = async (id) => {
            // Reboot the VM
            await (0, axios_1.default)({
                method: 'POST',
                url: `https://api.hetzner.cloud/v1/servers/${id}/actions/reboot`,
                headers: {
                    Authorization: 'Bearer ' + HETZNER_TOKEN,
                },
            });
            return;
        };
        this.reimageVM = async (id) => {
            // Rebuild the VM
            await (0, axios_1.default)({
                method: 'POST',
                url: `https://api.hetzner.cloud/v1/servers/${id}/actions/rebuild`,
                headers: {
                    Authorization: 'Bearer ' + HETZNER_TOKEN,
                },
                data: {
                    image: Number(this.imageId),
                },
            });
            return;
        };
        this.getVM = async (id) => {
            const response = await (0, axios_1.default)({
                method: 'GET',
                url: `https://api.hetzner.cloud/v1/servers/${id}`,
                headers: {
                    Authorization: 'Bearer ' + HETZNER_TOKEN,
                },
            });
            console.log('[GETVM] %s: %s rate limit remaining', id, response?.headers['ratelimit-remaining']);
            redis_1.redis?.set('hetznerApiRemaining', response?.headers['ratelimit-remaining']);
            const server = this.mapServerObject(response.data.server);
            return server;
        };
        this.listVMs = async (filter) => {
            const limit = this.getLimitSize();
            const pageCount = Math.ceil((limit || 1) / 50);
            const pages = Array.from(Array(pageCount).keys()).map((i) => i + 1);
            const responses = await Promise.all(pages.map((page) => (0, axios_1.default)({
                method: 'GET',
                url: `https://api.hetzner.cloud/v1/servers`,
                headers: {
                    Authorization: 'Bearer ' + HETZNER_TOKEN,
                },
                params: {
                    sort: 'id:asc',
                    page,
                    per_page: 50,
                    label_selector: filter,
                },
            })));
            const responsesMapped = responses.map((response) => response.data.servers.map(this.mapServerObject));
            return responsesMapped.flat();
        };
        this.powerOn = async (id) => {
            // Poweron the server (usually not needed)
            try {
                await (0, axios_1.default)({
                    method: 'POST',
                    url: `https://api.hetzner.cloud/v1/servers/${id}/actions/poweron`,
                    headers: {
                        Authorization: 'Bearer ' + HETZNER_TOKEN,
                        'Content-Type': 'application/json',
                    },
                });
            }
            catch (e) {
                console.log('%s failed to poweron', id);
            }
        };
        this.attachToNetwork = async (id) => {
            // // Attach server to network (usually not needed)
            // try {
            //   const response: any = await axios({
            //     method: 'GET',
            //     url: `https://api.hetzner.cloud/v1/servers/${id}`,
            //     headers: {
            //       Authorization: 'Bearer ' + HETZNER_TOKEN,
            //     },
            //   });
            //   if (response.data.server.private_net?.[0] == null) {
            //     await axios({
            //       method: 'POST',
            //       url: `https://api.hetzner.cloud/v1/servers/${id}/actions/attach_to_network`,
            //       headers: {
            //         Authorization: 'Bearer ' + HETZNER_TOKEN,
            //         'Content-Type': 'application/json',
            //       },
            //       data: {
            //         network:
            //           this.networks[Math.floor(Math.random() * this.networks.length)],
            //       },
            //     });
            //   }
            // } catch (e: any) {
            //   console.log('%s failed to attach to network', id);
            //   console.log(e.response?.data);
            // }
        };
        this.updateSnapshot = async () => {
            const response = await (0, axios_1.default)({
                method: 'POST',
                url: `https://api.hetzner.cloud/v1/servers`,
                headers: {
                    Authorization: 'Bearer ' + HETZNER_TOKEN,
                    'Content-Type': 'application/json',
                },
                data: {
                    name: 'vBrowserSnapshot',
                    server_type: 'cpx11',
                    start_after_create: true,
                    image: 'docker-ce', // 15512617 for Ubuntu 20.04
                    ssh_keys: sshKeys,
                    user_data: fs_1.default
                        .readFileSync(__dirname + '/../../dev/vbrowser.sh')
                        .toString()
                        .replace('{VBROWSER_ADMIN_KEY}', config_1.default.VBROWSER_ADMIN_KEY),
                    location: this.getRandomDatacenter(),
                },
            });
            const id = response.data.server.id;
            await new Promise((resolve) => setTimeout(resolve, 4 * 60 * 1000));
            // Validate snapshot server was created successfully
            // const response3 = await axios(
            //   'http://' + response.data.server.public_net?.ipv4?.ip + ':5000'
            // );
            const response2 = await (0, axios_1.default)({
                method: 'POST',
                url: `https://api.hetzner.cloud/v1/servers/${id}/actions/create_image`,
                headers: {
                    Authorization: 'Bearer ' + HETZNER_TOKEN,
                    'Content-Type': 'application/json',
                },
            });
            const imageId = response2.data.image.id;
            await this.terminateVM(id);
            return imageId;
        };
        this.mapServerObject = (server) => {
            const public_ip = server.public_net?.ipv4?.ip;
            // const private_ip = server.private_net?.[0]?.ip;
            const ip = public_ip;
            // We can use either the public or private IP for communicating between gateway and VM
            // Only signaling traffic goes through here since the video is transmitted over WebRTC
            // The private IP requires the server and gateway to be on the same network and there is a limit to the number of servers allowed
            return {
                id: server.id?.toString(),
                // The gateway handles SSL termination and proxies to the private IP
                host: ip ? `${this.gateway}/?ip=${ip}` : '',
                provider: this.id,
                large: this.isLarge,
                region: this.region,
            };
        };
    }
    getRandomDatacenter() {
        // US
        let datacenters = ['ash'];
        if (this.region === 'USW') {
            datacenters = ['hil'];
        }
        else if (this.region === 'EU') {
            datacenters = ['nbg1', 'fsn1', 'hel1'];
        }
        return datacenters[Math.floor(Math.random() * datacenters.length)];
    }
}
exports.Hetzner = Hetzner;
