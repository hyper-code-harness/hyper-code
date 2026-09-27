#!/bin/sh
# The test runner mounts its throwaway public key at /keys/id.pub.
set -e
cp /keys/id.pub /home/tester/.ssh/authorized_keys
chown -R tester:tester /home/tester/.ssh
chmod 600 /home/tester/.ssh/authorized_keys
exec /usr/sbin/sshd -D -e
