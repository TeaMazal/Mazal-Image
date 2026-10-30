#!/bin/sh
set -eu
envsubst '${MI_MAIN_ORIGIN}' < /etc/nginx/snippets/security-headers.conf.template > /etc/nginx/snippets/security-headers.conf
