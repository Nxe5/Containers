#!/usr/bin/env bash
# Open a URL in a specific Firefox container using the Company Containers
# extension's ext+container protocol.
#
# Usage:
#   open-in-container.sh [OPTIONS] URL
#
# Options:
#   -n, --name NAME    Container name hint (Google, Microsoft, Meta, or any name)
#   -c, --color COLOR  Container color if creating a new one
#   -i, --icon ICON    Container icon if creating a new one
#
# Examples:
#   open-in-container.sh https://mail.google.com
#   open-in-container.sh -n Google https://youtube.com
#   open-in-container.sh -n Work -c purple -i briefcase https://example.com

set -euo pipefail

FIREFOX="${FIREFOX:-firefox}"

urlencode() {
  local string="$1"
  local strlen=${#string}
  local encoded=""
  local pos c o

  for (( pos=0; pos<strlen; pos++ )); do
    c="${string:$pos:1}"
    case "$c" in
      [-_.~a-zA-Z0-9] ) o="$c" ;;
      * ) printf -v o '%%%02x' "'$c" ;;
    esac
    encoded+="$o"
  done
  echo "$encoded"
}

NAME=""
COLOR=""
ICON=""
URL=""

while [[ $# -gt 0 ]]; do
  key="$1"
  case $key in
    -n|--name)
      NAME="$2"
      shift 2
      ;;
    --name=*)
      NAME="${1#--name=}"
      shift
      ;;
    -c|--color)
      COLOR="$2"
      shift 2
      ;;
    --color=*)
      COLOR="${1#--color=}"
      shift
      ;;
    -i|--icon)
      ICON="$2"
      shift 2
      ;;
    --icon=*)
      ICON="${1#--icon=}"
      shift
      ;;
    -h|--help)
      sed -n '2,17p' "$0"
      exit 0
      ;;
    *)
      if [[ -z "$URL" ]]; then
        URL="$1"
      else
        echo "Error: only one URL allowed" >&2
        exit 1
      fi
      shift
      ;;
  esac
done

if [[ -z "$URL" ]]; then
  echo "Error: URL is required" >&2
  exit 1
fi

if [[ -z "$NAME" ]]; then
  NAME="${URL#*://}"       # strip scheme
  NAME="${NAME%%/*}"       # strip path
fi

ENCODED_URL="$(urlencode "$URL")"
FULL_URL="ext+container:url=${ENCODED_URL}&name=${NAME}"

if [[ -n "$COLOR" ]]; then
  FULL_URL="${FULL_URL}&color=${COLOR}"
fi

if [[ -n "$ICON" ]]; then
  FULL_URL="${FULL_URL}&icon=${ICON}"
fi

exec "$FIREFOX" "$FULL_URL"
