#! /usr/bin/env bash

set -euo pipefail

rm -rf public
rm -rf ../blog
hugo
cp -r public ../blog