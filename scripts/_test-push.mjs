// 临时验证：交互选 7 推送（无变更场景），expect 风格逐步输入
import { spawn } from "node:child_process";
import { writeFileSync } from "node:fs";

const out = [];
const script = spawn("cmd", ["/c", "manage-nav.bat"], {
  cwd: process.cwd(),
  stdio: ["pipe", "pipe", "inherit"],
});

// [提示片段, 发送内容, 需出现的次数]
const steps = [
  ["请选择操作", "7", 1],
  ["提交说明", "", 1],
  ["请选择操作", "0", 2],
];

let buf = "";
let sent = 0;
const count = (m) => (buf.match(new RegExp(m.replace(/[.*+?^${}()|[\]\\]/g, "\\$&"), "g")) || []).length;
const dump = (m) => out.push(m);

const t = setTimeout(() => { dump("[TIMEOUT]"); script.kill(); writeFileSync("scripts/_t3.txt", out.join("")); process.exit(1); }, 25000);

script.stdout.on("data", (d) => {
  const c = d.toString();
  dump(c);
  process.stdout.write(c);
  buf += c;
  const [m, text, need = 1] = steps[sent] ?? [];
  if (m && count(m) >= need) {
    sent++;
    dump(`>>> send(${sent - 1}): ${JSON.stringify(text)}\n`);
    setTimeout(() => script.stdin.write(text + "\n"), 300);
  }
});

script.on("exit", (c) => {
  clearTimeout(t);
  dump(`[exit ${c}]`);
  writeFileSync("scripts/_t3.txt", out.join(""));
  process.exit(c ?? 0);
});
