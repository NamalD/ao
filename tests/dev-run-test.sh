#!/bin/sh
set -eu

test_dir=$(mktemp -d)
trap 'rm -rf "$test_dir"' EXIT
mkdir "$test_dir/bin"

cat >"$test_dir/bin/make" <<'EOF'
#!/bin/sh
exit 1
EOF
cat >"$test_dir/bin/racket" <<'EOF'
#!/bin/sh
printf 'host started\n'
EOF
chmod +x "$test_dir/bin/make" "$test_dir/bin/racket"

output=$(cd "$test_dir" && PATH="$test_dir/bin:$PATH" RACKET="$test_dir/bin/racket" \
	"$OLDPWD/scripts/dev-run" 2>&1)

case "$output" in
	*'Ao build failed; running the previous successful build.'*'host started'*) ;;
	*)
		echo "dev-run did not start the host after a failed build:" >&2
		echo "$output" >&2
		exit 1
		;;
esac
