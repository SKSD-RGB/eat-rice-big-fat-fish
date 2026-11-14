#!/usr/bin/env bash
# 小鲸 APK 打包（2026-11-14 修：dex 用 STORED 写进去，不能用 jar uf）
set -u

ROOT="$(cd "$(dirname "$0")" && pwd)"
AND="$ROOT"
WORK="$AND/build"
PARENT="$(cd "$ROOT/.." && pwd)"
BT="$PARENT/build/sdk/build-tools/34.0.0"
JAVA="$PARENT/build/jdk-17.0.21+9/bin"
# 塞 dex 要用 python。优先用环境变量 PYTHON，其次找常见的 python，都没有就报错
if [ -n "${PYTHON:-}" ]; then
  PY="$PYTHON"
elif command -v python3 >/dev/null 2>&1; then
  PY=python3
elif command -v python >/dev/null 2>&1; then
  PY=python
else
  echo "找不到 python，请设置环境变量 PYTHON 指向你的 python 可执行文件"
  exit 1
fi

AAPT2="$BT/aapt2.exe"
ZIPALIGN="$BT/zipalign.exe"
APKSIGNER="$BT/apksigner.bat"
JAVAC="$JAVA/javac.exe"
JAVAEXE="$JAVA/java.exe"
APKJAR="$PARENT/build/sdk/platforms/android-34/android.jar"

export JAVA_HOME="$(cygpath -w "$JAVA/..")"
VERSION_NAME="10.5"
VERSION_CODE="105"

echo "=== 清理 ==="
rm -rf "$WORK"
mkdir -p "$WORK/res" "$WORK/gen" "$WORK/classes" "$WORK/dex" "$WORK/apk"

echo "=== 1. aapt2 compile ==="
"$AAPT2" compile --dir "$(cygpath -w "$AND/res")" -o "$(cygpath -w "$WORK/res.zip")" || exit 1
echo "  res.zip $(stat -c%s "$WORK/res.zip") 字节"

echo "=== 2. aapt2 link ==="
"$AAPT2" link --version-code "$VERSION_CODE" --version-name "$VERSION_NAME" -I "$(cygpath -w "$APKJAR")" --manifest "$(cygpath -w "$AND/AndroidManifest.xml")" --java "$(cygpath -w "$WORK/gen")" -o "$(cygpath -w "$WORK/apk/base.apk")" "$(cygpath -w "$WORK/res.zip")" || exit 1
echo "  base.apk $(stat -c%s "$WORK/apk/base.apk") 字节"

echo "=== 3. javac ==="
SRCS=$(find "$AND/src" "$WORK/gen" -name "*.java")
"$JAVAC" -encoding UTF-8 --release 8 -classpath "$(cygpath -w "$APKJAR")" -d "$(cygpath -w "$WORK/classes")" $SRCS > "$WORK/javac.log" 2>&1
CNT=$(find "$WORK/classes" -name "*.class" | wc -l)
echo "  class: $CNT 个"
if [ "$CNT" -lt 5 ]; then echo "  ✗ 编译失败"; head -30 "$WORK/javac.log"; exit 1; fi

echo "=== 4. d8 ==="
cd "$WORK/classes"
"$JAVAEXE" -cp "$(cygpath -w "$BT/lib/d8.jar")" com.android.tools.r8.D8 --debug --min-api 21 --lib "$(cygpath -w "$APKJAR")"  --output "$(cygpath -w "$WORK/dex")" $(find . -name "*.class") > "$WORK/d8.log" 2>&1
cd "$ROOT"
echo "  classes.dex $(stat -c%s "$WORK/dex/classes.dex") 字节"

echo "=== 5. 塞 dex（STORED，不压缩） ==="
"$PY" - "$(cygpath -w "$WORK/apk/base.apk")" "$(cygpath -w "$WORK/dex/classes.dex")" "$(cygpath -w "$WORK/apk/unsigned.apk")" << 'PYEOF'
import sys, zipfile, shutil
base, dex, out = sys.argv[1], sys.argv[2], sys.argv[3]
shutil.copy(base, out)
# 用 STORED 写入（Android 对压缩过的 dex 有时解析失败）
with zipfile.ZipFile(out, 'a', zipfile.ZIP_STORED) as z:
    z.write(dex, 'classes.dex')
print("  写入完成")
PYEOF
echo "  $(stat -c%s "$WORK/apk/unsigned.apk") 字节"

echo "=== 6. zipalign ==="
"$ZIPALIGN" -f -p 4 "$(cygpath -w "$WORK/apk/unsigned.apk")" "$(cygpath -w "$WORK/apk/aligned.apk")" || exit 1
echo "  $(stat -c%s "$WORK/apk/aligned.apk") 字节"

echo "=== 7. 签名 ==="
KEYSTORE="$(cygpath -w "$AND/xiaoman.keystore")"
"$APKSIGNER" sign --ks "$KEYSTORE" --ks-pass pass:xiaoman123 --ks-key-alias xiaoman --key-pass pass:xiaoman123 --out "$(cygpath -w "$WORK/小鲸-v$VERSION_NAME.apk")" "$(cygpath -w "$WORK/apk/aligned.apk")" || exit 1

echo ""
echo "  ✓ APK: $WORK/小鲸-v$VERSION_NAME.apk"
echo "  大小: $(( $(stat -c%s "$WORK/小鲸-v$VERSION_NAME.apk") / 1024 )) KB"
echo "  版本: v$VERSION_NAME ($VERSION_CODE)"
"$APKSIGNER" verify --print-certs "$(cygpath -w "$WORK/小鲸-v$VERSION_NAME.apk")" 2>&1 | grep -i "SHA-256"
