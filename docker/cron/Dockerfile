# Replaces Vercel Cron: BusyBox crond fires the two HUD cron routes over the
# compose network. TZ=America/New_York (set in compose) means the schedules are
# written in ET and follow daylight-saving on their own — no more UTC shifting.
FROM alpine:3.21
RUN apk add --no-cache curl tzdata
COPY crontab /etc/crontabs/root
COPY tick.sh /usr/local/bin/tick
RUN chmod +x /usr/local/bin/tick
CMD ["crond", "-f", "-l", "6"]
