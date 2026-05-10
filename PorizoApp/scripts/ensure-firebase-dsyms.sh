#!/bin/sh
set -eu

if [ "${PLATFORM_NAME:-}" = "iphonesimulator" ]; then
  echo "Skipping Firebase dSYM generation for simulator build"
  exit 0
fi

if [ -z "${DWARF_DSYM_FOLDER_PATH:-}" ]; then
  echo "warning: DWARF_DSYM_FOLDER_PATH is unset; cannot generate Firebase dSYMs"
  exit 0
fi

if [ -z "${TARGET_BUILD_DIR:-}" ] || [ -z "${FRAMEWORKS_FOLDER_PATH:-}" ]; then
  echo "warning: Target framework path is unavailable; cannot generate Firebase dSYMs"
  exit 0
fi

copy_to_archive_dsyms() {
  dsym_path="$1"

  if [ -n "${ARCHIVE_DSYMS_DIR:-}" ] && [ "${ARCHIVE_DSYMS_DIR}" != "${DWARF_DSYM_FOLDER_PATH}" ]; then
    mkdir -p "${ARCHIVE_DSYMS_DIR}"
    rm -rf "${ARCHIVE_DSYMS_DIR}/$(basename "${dsym_path}")"
    cp -R "${dsym_path}" "${ARCHIVE_DSYMS_DIR}/"
  elif [ -n "${ARCHIVE_PATH:-}" ] && [ -d "${ARCHIVE_PATH}" ]; then
    mkdir -p "${ARCHIVE_PATH}/dSYMs"
    rm -rf "${ARCHIVE_PATH}/dSYMs/$(basename "${dsym_path}")"
    cp -R "${dsym_path}" "${ARCHIVE_PATH}/dSYMs/"
  fi
}

generate_framework_dsym() {
  framework_name="$1"
  binary_path="${TARGET_BUILD_DIR}/${FRAMEWORKS_FOLDER_PATH}/${framework_name}.framework/${framework_name}"
  dsym_path="${DWARF_DSYM_FOLDER_PATH}/${framework_name}.framework.dSYM"

  if [ ! -f "${binary_path}" ]; then
    echo "warning: ${framework_name}.framework binary not found at ${binary_path}; skipping dSYM generation"
    return 0
  fi

  binary_uuid="$(dwarfdump --uuid "${binary_path}" | awk '/UUID:/ { print $2; exit }')"
  if [ -z "${binary_uuid}" ]; then
    echo "warning: Could not read UUID from ${binary_path}; skipping dSYM generation"
    return 0
  fi

  if [ -d "${dsym_path}" ]; then
    dsym_uuid="$(dwarfdump --uuid "${dsym_path}" | awk '/UUID:/ { print $2; exit }')"
    if [ "${dsym_uuid}" = "${binary_uuid}" ]; then
      echo "${framework_name}.framework.dSYM already matches ${binary_uuid}"
      copy_to_archive_dsyms "${dsym_path}"
      return 0
    fi
    rm -rf "${dsym_path}"
  fi

  mkdir -p "${DWARF_DSYM_FOLDER_PATH}"
  log_path="${TEMP_DIR:-/tmp}/${framework_name}-dsymutil.log"
  if ! dsymutil "${binary_path}" -o "${dsym_path}" 2>"${log_path}"; then
    cat "${log_path}"
    exit 1
  fi

  dsym_uuid="$(dwarfdump --uuid "${dsym_path}" | awk '/UUID:/ { print $2; exit }')"
  if [ "${dsym_uuid}" != "${binary_uuid}" ]; then
    echo "error: ${framework_name}.framework.dSYM UUID ${dsym_uuid:-<missing>} does not match binary UUID ${binary_uuid}"
    exit 1
  fi

  echo "Generated ${framework_name}.framework.dSYM for ${binary_uuid}"
  copy_to_archive_dsyms "${dsym_path}"
}

generate_framework_dsym "FirebaseAnalytics"
generate_framework_dsym "GoogleAppMeasurement"
