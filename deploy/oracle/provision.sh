#!/bin/sh
# Creates the Always Free network and VM for the HUD from the PC, with the OCI
# CLI (`pip install oci-cli`, `~/.oci/config` DEFAULT profile). Everything is
# in the tenancy root compartment and looked up by display name, so re-running
# reuses what already exists and only creates what is missing. It prints the
# VM's public IP at the end; nothing here touches the HUD stack itself
# (that is setup-vm.sh over SSH).
#
#   NAME=gladiator-hud SHAPE=VM.Standard.A1.Flex OCPUS=2 MEM=12 sh provision.sh
#
# Always Free limits: A1.Flex up to 4 OCPU / 24 GB in total; two E2.1.Micro.
# "Out of host capacity" on A1 is normal for new tenancies: re-run later, or
# fall back with SHAPE=VM.Standard.E2.1.Micro (x86, 1 GB, image built on the PC).
set -eu
export MSYS_NO_PATHCONV=1   # Git Bash: keep "0.0.0.0/0" and JSON intact
# On the PC the CLI lives in a short-path venv (C:\o) because pip cannot unpack
# oci-cli under the 260-char Windows path limit in the default site-packages.
command -v oci >/dev/null 2>&1 || PATH="/c/o/Scripts:$PATH"

NAME=${NAME:-gladiator-hud}
SHAPE=${SHAPE:-VM.Standard.A1.Flex}
OCPUS=${OCPUS:-2}
MEM=${MEM:-12}
SSH_PUB=${SSH_PUB:-$HOME/.ssh/gladiator-oracle.pub}
VCN_CIDR=10.0.0.0/16
SUBNET_CIDR=10.0.0.0/24

q() { oci "$@" --raw-output 2>/dev/null || true; }
nz() { [ -n "$1" ] && [ "$1" != "null" ]; }

# Root compartment = the tenancy; the AD list returns it without extra rights.
C=$(q iam availability-domain list --query 'data[0]."compartment-id"')
nz "$C" || { echo "[provision] OCI CLI not authenticated: check ~/.oci/config (user OCID, key, fingerprint)" >&2; exit 1; }
echo "[provision] tenancy $C"

# --- network ---------------------------------------------------------------
VCN=$(q network vcn list -c "$C" --display-name "$NAME" --lifecycle-state AVAILABLE --query 'data[0].id')
if ! nz "$VCN"; then
  VCN=$(oci network vcn create -c "$C" --display-name "$NAME" --cidr-block "$VCN_CIDR" --dns-label gladiator \
        --wait-for-state AVAILABLE --query data.id --raw-output)
  echo "[provision] created VCN $VCN"
else
  echo "[provision] VCN exists $VCN"
fi

IGW=$(q network internet-gateway list -c "$C" --vcn-id "$VCN" --display-name "$NAME" --lifecycle-state AVAILABLE --query 'data[0].id')
if ! nz "$IGW"; then
  IGW=$(oci network internet-gateway create -c "$C" --vcn-id "$VCN" --display-name "$NAME" --is-enabled true \
        --wait-for-state AVAILABLE --query data.id --raw-output)
  echo "[provision] created internet gateway"
fi

RT=$(q network vcn get --vcn-id "$VCN" --query 'data."default-route-table-id"')
oci network route-table update --rt-id "$RT" --force \
  --route-rules "[{\"destination\":\"0.0.0.0/0\",\"destinationType\":\"CIDR_BLOCK\",\"networkEntityId\":\"$IGW\"}]" >/dev/null
echo "[provision] default route -> internet gateway"

SL=$(q network vcn get --vcn-id "$VCN" --query 'data."default-security-list-id"')
oci network security-list update --security-list-id "$SL" --force --ingress-security-rules '[
  {"protocol":"6","source":"0.0.0.0/0","isStateless":false,"tcpOptions":{"destinationPortRange":{"min":22,"max":22}}},
  {"protocol":"6","source":"0.0.0.0/0","isStateless":false,"tcpOptions":{"destinationPortRange":{"min":80,"max":80}}},
  {"protocol":"6","source":"0.0.0.0/0","isStateless":false,"tcpOptions":{"destinationPortRange":{"min":443,"max":443}}},
  {"protocol":"1","source":"0.0.0.0/0","isStateless":false,"icmpOptions":{"type":3,"code":4}}
]' >/dev/null
echo "[provision] ingress 22/80/443 on the default security list"

SUB=$(q network subnet list -c "$C" --vcn-id "$VCN" --display-name "$NAME" --lifecycle-state AVAILABLE --query 'data[0].id')
if ! nz "$SUB"; then
  SUB=$(oci network subnet create -c "$C" --vcn-id "$VCN" --display-name "$NAME" --cidr-block "$SUBNET_CIDR" --dns-label hud \
        --wait-for-state AVAILABLE --query data.id --raw-output)
  echo "[provision] created public subnet"
fi

# --- instance --------------------------------------------------------------
INST=$(q compute instance list -c "$C" --display-name "$NAME" --lifecycle-state RUNNING --query 'data[0].id')
if ! nz "$INST"; then
  IMG=$(q compute image list -c "$C" --operating-system "Canonical Ubuntu" --operating-system-version "24.04" \
        --shape "$SHAPE" --sort-by TIMECREATED --sort-order DESC --query 'data[0].id')
  nz "$IMG" || { echo "[provision] no Ubuntu 24.04 image for $SHAPE in this region" >&2; exit 1; }
  case "$SHAPE" in
    *Flex) SHAPE_CFG="--shape-config {\"ocpus\":$OCPUS,\"memoryInGBs\":$MEM}" ;;
    *)     SHAPE_CFG="" ;;
  esac
  launched=""
  for AD in $(q iam availability-domain list --query 'data[].name' | tr -d '[]", ' | tr '\n' ' '); do
    echo "[provision] launching $SHAPE in $AD ..."
    # shellcheck disable=SC2086
    if INST=$(oci compute instance launch -c "$C" --availability-domain "$AD" --shape "$SHAPE" $SHAPE_CFG \
          --image-id "$IMG" --subnet-id "$SUB" --assign-public-ip true --display-name "$NAME" \
          --ssh-authorized-keys-file "$SSH_PUB" --wait-for-state RUNNING --query data.id --raw-output 2>/tmp/launch.err); then
      launched=1; break
    fi
    grep -qi "capacity" /tmp/launch.err && { echo "[provision] $AD: out of host capacity"; continue; }
    cat /tmp/launch.err >&2; exit 1
  done
  [ -n "$launched" ] || { echo "[provision] no capacity for $SHAPE in any AD right now; re-run later or SHAPE=VM.Standard.E2.1.Micro" >&2; exit 2; }
  echo "[provision] instance RUNNING $INST"
else
  echo "[provision] instance exists $INST"
fi

IP=$(q compute instance list-vnics --instance-id "$INST" --query 'data[0]."public-ip"')
echo "[provision] public IP: $IP"
echo "[provision] next: ssh -i ~/.ssh/gladiator-oracle ubuntu@$IP 'REF=claude/oracle-hud sh -s' < deploy/oracle/setup-vm.sh"
