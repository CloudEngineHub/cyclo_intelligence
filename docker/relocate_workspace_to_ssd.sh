#!/bin/bash
# Relocate cyclo_intelligence's workspace + huggingface bind-mount targets
# from the SD card (/dev/mmcblk0p1) to NVMe (/mnt/ssd). docker-compose keeps
# mounting ./workspace and ./huggingface; those repo-local paths resolve via
# symlinks to /mnt/ssd/cyclo_intelligence/{workspace,huggingface}.
#
# Run with: sudo bash relocate_workspace_to_ssd.sh
set -euo pipefail

SCRIPT_DIR=$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)
REPO="${CYCLO_REPO:-$(cd "$SCRIPT_DIR/.." && pwd)}"
SSD_ROOT="${CYCLO_SSD_ROOT:-/mnt/ssd/cyclo_intelligence}"
SRC_W=$REPO/docker/workspace
SRC_H=$REPO/docker/huggingface
DST_W=$SSD_ROOT/workspace
DST_H=$SSD_ROOT/huggingface
OWNER="${CYCLO_STORAGE_USER:-${SUDO_USER:-$(id -un)}}"
GROUP="${CYCLO_STORAGE_GROUP:-$(id -gn "$OWNER" 2>/dev/null || id -gn)}"

path_is_empty_dir() {
    [ -d "$1" ] && [ -z "$(find "$1" -mindepth 1 -maxdepth 1 -print -quit)" ]
}

backup_path_for() {
    local path="$1"
    local stamp
    local candidate
    local index=0

    stamp="$(date +%Y%m%d-%H%M%S)"
    candidate="${path}.local-before-ssd-${stamp}"
    while [ -e "$candidate" ] || [ -L "$candidate" ]; do
        index=$((index + 1))
        candidate="${path}.local-before-ssd-${stamp}.${index}"
    done
    printf '%s\n' "$candidate"
}

migrate_local_dir_to_ssd() {
    local src_path="$1"
    local target_path="$2"
    local label="$3"

    if [ ! -d "$src_path" ] || [ -L "$src_path" ]; then
        return 0
    fi
    if path_is_empty_dir "$src_path"; then
        return 0
    fi
    if ! command -v rsync >/dev/null 2>&1; then
        echo "Error: rsync is required to migrate existing ${label} data to SSD." >&2
        exit 1
    fi

    echo "Migrating existing ${label} data to ${target_path} without overwriting SSD files."
    rsync -aHP --ignore-existing --remove-source-files "$src_path"/ "$target_path"/
    find "$src_path" -depth -type d -empty -delete || true
}

replace_with_symlink() {
    local src_path="$1"
    local target_path="$2"
    local label="$3"
    local backup_path
    local src_real
    local target_real

    if [ -L "$src_path" ]; then
        src_real="$(readlink -f "$src_path" 2>/dev/null || true)"
        target_real="$(readlink -f "$target_path" 2>/dev/null || true)"
        if [ -n "$src_real" ] && [ "$src_real" = "$target_real" ]; then
            return 0
        fi
        backup_path="$(backup_path_for "$src_path")"
        mv "$src_path" "$backup_path"
        echo "Preserved previous ${label} symlink at ${backup_path}."
    fi

    if [ -d "$src_path" ]; then
        migrate_local_dir_to_ssd "$src_path" "$target_path" "$label"
    fi

    if [ -e "$src_path" ] || [ -L "$src_path" ]; then
        if path_is_empty_dir "$src_path"; then
            rmdir "$src_path"
        else
            backup_path="$(backup_path_for "$src_path")"
            mv "$src_path" "$backup_path"
            echo "Preserved remaining local ${label} data at ${backup_path}."
        fi
    fi

    [ -L "$src_path" ] || ln -s "$target_path" "$src_path"
}

echo "=== 1/6  containers using these mounts: stop them ==="
for c in cyclo_intelligence groot_server lerobot_server; do
    if docker ps -a --format '{{.Names}}' | grep -qx "$c"; then
        echo "  stopping $c"
        docker stop "$c" || true
    fi
done

echo "=== 2/6  prepare destination on NVMe ==="
mkdir -p "$DST_W" "$DST_H"
chown "$OWNER:$GROUP" "$SSD_ROOT" "$DST_W" "$DST_H"

echo "=== 3/6  migrate workspace -> $DST_W (SSD files win on conflicts) ==="
migrate_local_dir_to_ssd "$SRC_W" "$DST_W" "workspace"

echo "=== 4/6  migrate huggingface -> $DST_H (SSD files win on conflicts) ==="
migrate_local_dir_to_ssd "$SRC_H" "$DST_H" "huggingface"

echo "=== 5/6  symlink $SRC_W -> $DST_W and $SRC_H -> $DST_H ==="
replace_with_symlink "$SRC_W" "$DST_W" "workspace"
replace_with_symlink "$SRC_H" "$DST_H" "huggingface"

echo "=== 6/6  result ==="
ls -la "$SRC_W" "$SRC_H"
df -h / "$SSD_ROOT" | tail -2

echo
echo "Done. Restart containers with:"
echo "  docker/container.sh start"
echo "  docker/container.sh start-lerobot  # if needed"
echo "  docker/container.sh start-groot    # if needed"
