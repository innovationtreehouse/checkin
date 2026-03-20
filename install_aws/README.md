# AWS Installation & Maintenance

## Viewing Logs
To view the live application logs for the Checkmein service (including cron jobs and API endpoints), run the following command on the EC2 instance:

```bash
sudo journalctl -u checkmein.service -n 1000 -f
```

- `-u checkmein.service`: Filters for our specific systemd service.
- `-n 1000`: Shows the last 1000 lines of logs.
- `-f`: "Follows" the logs (streams new logs live to your terminal). Press `Ctrl+C` to exit.
