# Her Haus Hub

The team operations hub for Her Haus Co.: a time clock with breaks, live earnings, client kanban boards, EOD reports, employee profiles and Google Chat alerts.

## Run it on your computer

```bash
python3 -m venv .venv
.venv/bin/pip install -r requirements.txt
ADMIN_EMAIL=admin@herhauscompany.com .venv/bin/python app.py
```

Open http://localhost:5050.

The first time it runs, it creates one **executive** account using `ADMIN_EMAIL`. The temporary password is saved in `data/FIRST_LOGIN.txt`. Log in, set your own password, then delete that file.

## Deploy it so the team can use it (Render)

The repo includes a `render.yaml`, so Render sets up almost everything for you. The cost is about **US$7/month** for the Starter server, plus about **$1/month** for a 5 GB disk.

1. Put this folder in a **private** GitHub repository.
2. On [render.com](https://render.com), go to **New → Blueprint** and pick the repo.
3. When Render asks for `ADMIN_EMAIL`, enter the email you'll sign in with. Click **Apply**.
4. When the deploy finishes, open the **Shell** tab and run `cat /var/data/FIRST_LOGIN.txt` to get your temporary password.
   - Sign in, set your own password, then delete the file with `rm /var/data/FIRST_LOGIN.txt`.
5. In the Hub, go to **Settings** and:
   - set **Hub web address** to your live URL
   - paste your Google Chat webhooks
6. Optional: to use your own web address (for example `hub.herhauscompany.com`), go to **Settings → Custom Domains** in Render. Add the CNAME record it shows at your domain provider; Render issues the HTTPS certificate for you.

What Render handles for you:
- **Your data:** the database and every upload live on the persistent disk at `/var/data`, and Render backs that disk up daily. Without a disk, data is wiped on every deploy, which is why the free plan won't work.
- **Updates:** push to GitHub and Render redeploys. The database upgrades itself on startup.
- **Settings:** `SECRET_KEY` is generated for you, and cookies are set to HTTPS-only.

Run a single worker (`-w 1`), as `render.yaml` already does. Everything still runs correctly with more, but the login-attempt limiter only works properly with one.

**Other hosts:** any server that can run Python and has a persistent disk works, such as Railway (with a volume), Fly.io (with a volume), or a $6/month DigitalOcean droplet. Use the same start command:
`gunicorn -w 1 --threads 8 -b 0.0.0.0:$PORT app:app`, with `DATA_DIR` pointing at the persistent disk.

## Connect Google Chat

1. In Google Chat, open the space you want alerts in.
2. Go to **Apps & integrations → Webhooks → Add webhook**, then copy the URL.
3. In the Hub, go to **Settings → Google Chat** and paste it into **Shift alerts webhook**.
4. Make a second webhook in your EOD space and paste it into **EOD channel webhook**.
5. Click **Send test message** for each one.

Clock-in alerts are always sent. Clock-out and break alerts are optional and can be turned on in Settings.

## How pay is calculated

- **Cutoffs:** the 1st–15th and the 16th to the end of the month, in the company timezone (Settings).
- **Hourly rate:** salary per cutoff ÷ (workdays in that cutoff × shift hours per day).
  - Example: ₱15,000 ÷ (11 days × 8 h) = ₱170.45/h.
- **Earned so far:** hours worked × hourly rate.
  - Hours worked = clocked time minus breaks and lunch.
  - It counts up live while the person is on shift.
- **Timesheets & Payroll** shows every cutoff and exports a CSV. Executives can fix entries there when someone forgets to clock out.

## Task metrics

A task counts as completed on the date it's moved to **Done**. If it's moved out of Done, it stops counting. On-time means it was completed on or before its deadline. To keep the board tidy, the Done column shows only the last 14 days, with a link to show older tasks. Every completed task still counts in the metrics.

## Comments, mentions & notifications

Every task has a comment thread. Type **@** to tag a teammate, then pick them from the list with the arrow keys and Enter. Press ⌘/Ctrl + Enter to post.

The bell in the top bar and the **Notifications** page show three kinds of alerts:
- when someone **mentions** you
- when someone **comments** on a task you're assigned to, created, or have commented on
- when a task is **assigned** to you, including by an automation

The bell updates every 30 seconds. Opening a task marks its notifications as read. Task Notes were replaced by comments; any existing notes were moved into each task's first comment.

## Archive

The **Archive** (in the sidebar) keeps finished and retired work out of the way without deleting it.

- **Tasks.** Done tasks are archived automatically N days after they're finished (14 by default; change it in Settings, or set it to 0 to turn it off). You can also archive a task by hand from the task window, or archive all of a board's done tasks at once with the button on the Done column.
  - Search covers titles, descriptions, and comments. Filter by client, person, or status.
  - Archived tasks still count in Task Metrics.
  - A restored task goes back on the board and isn't re-archived right away.
- **Clients.** Archived clients go here and can be restored with all their tasks.
- **Former team members.** Deactivated accounts, with their full history and a Reactivate button.

Everyone can archive and restore tasks. Only executives can delete a task permanently.

## Google Chat task alerts

Set this up under **Settings → Google Chat · Task alerts**: paste a webhook for the team's task space and choose which events post there.
- **Events you can turn on:** new task, assigned, completed (marked on time or late), moved to another column, new comment.
- **Daily digest:** overdue and due-today tasks, sent at a set time on work days.

To send one client's alerts to its own space, open **Clients → Edit** and paste that space's webhook. Clients without one use the team default.

Each message includes an "Open in Her Haus Hub" link that opens that exact task. Set **Hub web address** in Settings to your live URL.

## Recurring task automations

Each client board has an **Automations** button. An automation adds a task to that board on a schedule:
- daily, every weekday, chosen days of the week, or a day of the month
- at a set time, in the company timezone

Each automation can also set an assignee, priority, starting column, and a deadline a set number of days after the task is created.

The server checks for due automations every 30 seconds.
- If the server was off when one was due, it creates **one** task when it's back, not one for every missed run.
- **Skip if the previous one isn't done** stops tasks from piling up.
- Running several gunicorn workers is safe: each automation runs only once.

## Roles

| | Employee | Executive |
|---|---|---|
| Time clock, EOD, own profile & photo, resources, client boards | ✓ | ✓ |
| Task metrics (weekly / monthly / annual) | Own tasks | Whole team, filter by person or client |
| Log wins & weekly metrics, update KPI progress, respond to incidents | ✓ | ✓ |
| Upload own bank QR / bank details | ✓ | ✓ (anyone's) |
| Add users, set salary, create clients, file incidents, set KPIs, review metric alignment | | ✓ |
| Overview, timesheets & payroll, all EODs, settings | | ✓ |

Executives can switch between **Executive** and **Employee** view in the sidebar. Bank details and QR codes are visible only to the employee they belong to and to executives.
