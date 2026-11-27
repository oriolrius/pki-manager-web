# Throwaway sshd for the release acceptance runner (checks/ssh.sh). Never published.
FROM alpine:3.22
RUN apk add --no-cache openssh-server \
 && adduser -D -s /bin/sh acc \
 && sed -i 's/^acc:!/acc:*/' /etc/shadow \
 && mkdir -p /etc/ssh/principals /run/sshd
EXPOSE 2222
CMD ["/usr/sbin/sshd", "-D", "-e", "-f", "/etc/ssh/accept/sshd_config"]
