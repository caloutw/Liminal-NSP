import cluster from "cluster"
import os from 'os';
import fs from 'fs';

let maxTheard = fs.existsSync(`/sys/fs/cgroup/cpu.max`) ? (() => {
    const linuxCpusConfig = fs.readFileSync(`/sys/fs/cgroup/cpu.max`, 'utf-8').split(" ");
    let availableCpu = ((linuxCpusConfig[0] == "max" ? os.cpus().length * linuxCpusConfig[1] : linuxCpusConfig[0]) / linuxCpusConfig[1]);

    if (availableCpu < 1)
        availableCpu = 1;

    return availableCpu;
})() : os.cpus().length - 1;

if(cluster.isPrimary){
    Array.from({length: maxTheard}, (v, i) => i).forEach(v => {
        cluster.fork();
    })
} else {
    await import("./main.js");
}