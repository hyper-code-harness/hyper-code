# Disposable sshd for remote.* tests. Two flavours from one file:
#   default          — bash, tmux, rsync, coreutils; NO ripgrep (exercises the grep/find fallbacks)
#   --build-arg RG=1 — same plus ripgrep (exercises the rg paths)
FROM alpine:3.20
ARG RG=0
RUN apk add --no-cache openssh-server bash tmux rsync coreutils procps findutils grep \
 && if [ "$RG" = "1" ]; then apk add --no-cache ripgrep; fi \
 && adduser -D -s /bin/bash tester && passwd -u tester >/dev/null 2>&1 || true \
 && mkdir -p /home/tester/.ssh && chmod 700 /home/tester/.ssh \
 && ssh-keygen -A \
 && sed -i 's/^#\?PasswordAuthentication.*/PasswordAuthentication no/; s/^#\?PermitRootLogin.*/PermitRootLogin no/; s/^#\?AllowTcpForwarding.*/AllowTcpForwarding no/' /etc/ssh/sshd_config \
 && echo 'MaxSessions 64' >> /etc/ssh/sshd_config \
 && echo 'MaxStartups 64:30:128' >> /etc/ssh/sshd_config
COPY entrypoint.sh /entrypoint.sh
RUN chmod +x /entrypoint.sh
EXPOSE 22
ENTRYPOINT ["/entrypoint.sh"]
