import { readFileSync, writeFileSync } from "node:fs"

type ConfigParams = {
    port: number;
}

export class Config {
    private data: ConfigParams;

    constructor(data: ConfigParams) {
        this.data = data;
    }
    
    getPort(): number {
        return this.data.port;
    }

    setPort(port: number) {
        this.data.port = port;
    }

    update(path: string) {
        writeFileSync(path, JSON.stringify(this.data, null, 4))
    }
    
    static readConfig(path: string): Config {
        const rawData = readFileSync(path).toString();

        return new Config(JSON.parse(rawData));
    }
}


export const defaultConfig = new Config({port: 8080});