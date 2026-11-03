const { execFileSync } = require("node:child_process");
const path = require("node:path");

const androidDir = path.resolve(__dirname, "..", "android");

if (process.platform === "win32") {
  execFileSync("cmd.exe", ["/d", "/s", "/c", "gradlew.bat assembleDebug"], {
    cwd: androidDir,
    stdio: "inherit",
  });
} else {
  execFileSync("bash", ["gradlew", "assembleDebug"], {
    cwd: androidDir,
    stdio: "inherit",
  });
}
