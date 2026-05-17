#!/usr/bin/env python3
"""
Liquid Torrent — libtorrent Sidecar Engine
Headless torrent engine communicating via JSON-RPC over stdin/stdout.
Based on TorrentLiteApp's torrent_engine.py (python-libtorrent).
"""
import os, sys, json, time, threading, datetime, tempfile
from typing import Dict, Any, Optional

import libtorrent as lt

# ─── Engine ────────────────────────────────────────────────────

class SidecarEngine:
    def __init__(self):
        self.session: Optional[lt.session] = None
        self.torrents: Dict[str, lt.torrent_handle] = {}
        self.info_cache: Dict[str, dict] = {}
        self._static_cached = set()
        self._resume_dir = ""
        self._data_path = ""
        self._torrents_path = ""
        self._settings_path = ""
        self._settings = {}
        self._lock = threading.Lock()
        self._running = False
        self._update_cycle = 0

    # ─── Init ──────────────────────────────────────────────

    def init(self, data_path: str):
        self._data_path = data_path
        os.makedirs(data_path, exist_ok=True)
        self._settings_path = os.path.join(data_path, "settings.json")
        self._torrents_path = os.path.join(data_path, "torrents.json")
        self._resume_dir = os.path.join(data_path, "resume_data")
        os.makedirs(self._resume_dir, exist_ok=True)

        self._settings = self._load_settings()
        self._create_session()
        self._running = True

        # Background update thread
        t = threading.Thread(target=self._update_loop, daemon=True)
        t.start()
        log(f"Engine initialized | dataPath={data_path}")

    def _load_settings(self) -> dict:
        defaults = {
            "downloadDir": os.path.expanduser("~/Downloads"),
            "maxDownloadSpeed": 0,
            "maxUploadSpeed": 0,
            "maxConnections": 500,
            "port": 6881,
            "activeDownloads": -1,
            "activeSeeds": -1,
            "activeLimit": -1,
        }
        try:
            if os.path.exists(self._settings_path):
                with open(self._settings_path, "r", encoding="utf-8") as f:
                    saved = json.load(f)
                defaults.update(saved)
        except Exception:
            pass
        # Migrate old -1 speed limits to 0 (unlimited)
        if defaults.get("maxDownloadSpeed", 0) == -1:
            defaults["maxDownloadSpeed"] = 0
        if defaults.get("maxUploadSpeed", 0) == -1:
            defaults["maxUploadSpeed"] = 0
        return defaults

    def _save_settings(self):
        try:
            with open(self._settings_path, "w", encoding="utf-8") as f:
                json.dump(self._settings, f, indent=2)
        except Exception:
            pass

    def _create_session(self):
        self.session = lt.session()
        s = self._settings
        port = s.get("port", 6881)
        pack = {
            # ── Identity ──
            "user_agent": "LiquidTorrent/1.4",
            "listen_interfaces": f"0.0.0.0:{port},[::0]:{port}",
            "alert_mask": (
                lt.alert.category_t.status_notification
                | lt.alert.category_t.error_notification
                | lt.alert.category_t.storage_notification
            ),
            # ── Trackers / DHT / LSD ──
            "announce_to_all_tiers": True,
            "announce_to_all_trackers": True,
            "enable_dht": True,
            "enable_lsd": True,
            "enable_upnp": True,
            "enable_natpmp": True,
            "dht_bootstrap_nodes": "router.bittorrent.com:6881,router.utorrent.com:6881,dht.transmissionbt.com:6881",
            # ── Connection limits (qBittorrent-like) ──
            "connections_limit": s.get("maxConnections", 500),
            "allow_multiple_connections_per_ip": True,
            # ── Queuing: disable auto-queuing limits → all torrents active ──
            # (mirrors qBittorrent with queuing disabled: -1 = unlimited)
            "active_downloads": s.get("activeDownloads", -1),
            "active_seeds": s.get("activeSeeds", -1),
            "active_limit": s.get("activeLimit", -1),
            "active_tracker_limit": -1,
            "active_dht_limit": -1,
            "active_lsd_limit": -1,
            # ── Performance (matched from qBittorrent defaults) ──
            "send_buffer_watermark": 500 * 1024,      # 500 KB
            "send_buffer_low_watermark": 10 * 1024,    # 10 KB
            "send_buffer_watermark_factor": 50,
            "choking_algorithm": 0,                    # fixed_slots_choker
            "seed_choking_algorithm": 1,                # fastest_upload
            "mixed_mode_algorithm": 0,                  # prefer_tcp
            "piece_extent_affinity": True,
            # ── Protocols ──
            "enable_incoming_tcp": True,
            "enable_outgoing_tcp": True,
            "enable_incoming_utp": True,
            "enable_outgoing_utp": True,
            # ── Rate limits (0 = unlimited per libtorrent spec) ──
            "download_rate_limit": s.get("maxDownloadSpeed", 0),
            "upload_rate_limit": s.get("maxUploadSpeed", 0),
        }

        self.session.apply_settings(pack)

    # ─── Background Update ─────────────────────────────────

    def _update_loop(self):
        while self._running:
            try:
                self._process_alerts()
                with self._lock:
                    items = list(self.torrents.items())
                for tid, h in items:
                    if not h.is_valid():
                        with self._lock:
                            self.torrents.pop(tid, None)
                            self.info_cache.pop(tid, None)
                            self._static_cached.discard(tid)
                        continue
                    self._update_info(tid, h)
                self._update_cycle += 1
                # Auto-save torrents list every 30 sec
                if self._update_cycle % 30 == 0:
                    self._save_torrents()
                # Save resume data every 5 min
                if self._update_cycle >= 300:
                    self._update_cycle = 0
                    self._save_all_resume()
            except Exception as e:
                log(f"Update error: {e}")
            time.sleep(1.0)

    def _process_alerts(self):
        if not self.session:
            return
        alerts = self.session.pop_alerts()
        for a in alerts:
            try:
                if isinstance(a, lt.save_resume_data_alert):
                    h = a.handle
                    if h.is_valid():
                        tid = str(h.info_hash())
                        data = lt.write_resume_data_buf(a.params)
                        p = os.path.join(self._resume_dir, f"{tid}.resume")
                        with open(p, "wb") as f:
                            f.write(data)
                elif isinstance(a, lt.torrent_finished_alert):
                    h = a.handle
                    if h.is_valid():
                        try:
                            h.save_resume_data()
                        except Exception:
                            pass
            except Exception:
                pass

    def _update_info(self, tid: str, handle: lt.torrent_handle):
        try:
            status = handle.status()
            info = self.info_cache.get(tid, {})

            info["id"] = tid
            info["infoHash"] = tid
            info["name"] = status.name if status.name else "Загрузка метаданных..."
            info["savePath"] = os.path.join(status.save_path, status.name or "")
            info["paused"] = bool(status.paused)
            # For checking state, show check progress instead of download progress
            if status.state in (lt.torrent_status.checking_files, lt.torrent_status.checking_resume_data):
                info["progress"] = round(status.progress * 100)
            else:
                info["progress"] = round(status.total_wanted_done * 100 / status.total_wanted) if status.total_wanted > 0 else 0
            info["downloadSpeed"] = status.download_rate
            info["uploadSpeed"] = status.upload_rate
            info["size"] = status.total_wanted
            info["totalDownload"] = status.total_download
            info["totalUpload"] = status.total_upload
            info["numPeers"] = status.num_peers
            info["numSeeds"] = status.num_seeds
            info["ratio"] = (status.total_upload / status.total_download) if status.total_download > 0 else 0

            # State — check libtorrent state first, then paused flag
            # (checking_files/checking_resume_data should show even if paused flag is set)
            if status.state == lt.torrent_status.checking_files:
                state = f"Проверка файлов ({round(status.progress * 100)}%)"
            elif status.state == lt.torrent_status.checking_resume_data:
                state = "Проверка resume data..."
            elif status.paused:
                state = "Приостановлено"
            elif status.state == lt.torrent_status.downloading_metadata:
                state = "Загрузка метаданных"
            elif status.state == lt.torrent_status.downloading:
                state = "Загрузка"
            elif status.state in (lt.torrent_status.finished, lt.torrent_status.seeding):
                state = "Раздача" if status.upload_rate > 0 else "Завершено"
            else:
                state = "Загрузка"
            info["state"] = state

            # ETA
            info["eta"] = int((status.total_wanted - status.total_wanted_done) / status.download_rate) if status.download_rate > 0 else 0

            # Magnet URI
            try:
                info["magnetURI"] = lt.make_magnet_uri(handle)
            except Exception:
                info["magnetURI"] = ""

            # Static info (cached once)
            if handle.has_metadata() and tid not in self._static_cached:
                ti = handle.get_torrent_info()
                info["creationDate"] = datetime.datetime.fromtimestamp(ti.creation_date()).isoformat() if ti.creation_date() > 0 else None
                info["comment"] = ti.comment() if ti.comment() else None
                files = []
                fs = ti.files()
                for i in range(ti.num_files()):
                    fp = handle.file_progress()
                    files.append({
                        "index": i,
                        "path": fs.file_path(i),
                        "name": os.path.basename(fs.file_path(i)),
                        "size": fs.file_size(i),
                        "progress": round(fp[i] * 100 / fs.file_size(i)) if fs.file_size(i) > 0 else 0,
                    })
                info["files"] = files
                info["trackers"] = [t.url for t in ti.trackers()]
                self._static_cached.add(tid)

            self.info_cache[tid] = info
        except Exception as e:
            log(f"Update info error for {tid}: {e}")

    # ─── Torrent Operations ────────────────────────────────

    def load_saved(self):
        try:
            if not os.path.exists(self._torrents_path):
                return
            with open(self._torrents_path, "r", encoding="utf-8") as f:
                data = json.load(f)
            for entry in data:
                try:
                    tid = entry.get("infoHash") or entry.get("id")
                    save_path = entry.get("savePath") or entry.get("save_path") or self._settings["downloadDir"]
                    paused = entry.get("paused", False)

                    # Try resume data first (instant restore!)
                    resume_path = os.path.join(self._resume_dir, f"{tid}.resume")
                    if tid and os.path.exists(resume_path):
                        try:
                            with open(resume_path, "rb") as rf:
                                rd = rf.read()
                            params = lt.read_resume_data(rd)
                            params.save_path = save_path
                            if paused:
                                # qBittorrent pattern: paused + NOT auto_managed = stays paused
                                params.flags |= lt.torrent_flags.paused
                                params.flags &= ~lt.torrent_flags.auto_managed
                            else:
                                params.flags &= ~lt.torrent_flags.paused
                                params.flags |= lt.torrent_flags.auto_managed
                            h = self.session.add_torrent(params)
                            self.torrents[str(h.info_hash())] = h
                            continue
                        except Exception:
                            pass

                    # Fallback: torrent file or magnet
                    torrent_files_dir = os.path.join(self._data_path, "torrent-files")
                    torrent_file = os.path.join(torrent_files_dir, f"{tid}.torrent") if tid else None

                    if torrent_file and os.path.exists(torrent_file):
                        self.add_torrent_file(torrent_file, save_path, not paused)
                    elif entry.get("magnetURI") or entry.get("magnet_uri"):
                        uri = entry.get("magnetURI") or entry.get("magnet_uri")
                        self.add_magnet(uri, save_path, not paused)
                except Exception as e:
                    log(f"Restore error: {e}")
            log(f"Restored {len(data)} torrents")
        except Exception as e:
            log(f"Load saved error: {e}")

    def add_torrent_file(self, file_path: str, save_path: str = None, start: bool = True) -> dict:
        sp = save_path or self._settings["downloadDir"]
        os.makedirs(sp, exist_ok=True)
        with open(file_path, "rb") as f:
            data = f.read()
        ti = lt.torrent_info(lt.bdecode(data))
        params = {"ti": ti, "save_path": sp}
        if not start:
            # Set paused flag for initial add
            params["flags"] = lt.torrent_flags.paused
        h = self.session.add_torrent(params)
        if not start:
            # qBittorrent pattern: unset auto_managed so libtorrent won't auto-resume
            h.unset_flags(lt.torrent_flags.auto_managed)
        tid = str(h.info_hash())
        with self._lock:
            self.torrents[tid] = h
        # Save .torrent file
        tfd = os.path.join(self._data_path, "torrent-files")
        os.makedirs(tfd, exist_ok=True)
        dest = os.path.join(tfd, f"{tid}.torrent")
        if not os.path.exists(dest):
            with open(dest, "wb") as f:
                f.write(data)
        self._save_torrents()
        self._update_info(tid, h)
        return self.info_cache.get(tid, {"id": tid, "infoHash": tid})

    def add_magnet(self, uri: str, save_path: str = None, start: bool = True) -> dict:
        sp = save_path or self._settings["downloadDir"]
        os.makedirs(sp, exist_ok=True)
        params = lt.parse_magnet_uri(uri)
        params.save_path = sp
        if not start:
            params.flags |= lt.torrent_flags.paused
        h = self.session.add_torrent(params)
        if not start:
            # qBittorrent pattern: unset auto_managed so libtorrent won't auto-resume
            h.unset_flags(lt.torrent_flags.auto_managed)
        tid = str(h.info_hash())
        with self._lock:
            self.torrents[tid] = h
        self._save_torrents()
        return {"id": tid, "infoHash": tid, "name": "Загрузка метаданных...", "state": "Загрузка метаданных",
                "paused": not start, "progress": 0, "downloadSpeed": 0, "uploadSpeed": 0,
                "size": 0, "totalDownload": 0, "totalUpload": 0, "numPeers": 0, "numSeeds": 0,
                "eta": 0, "savePath": sp, "magnetURI": uri, "ratio": 0,
                "creationDate": None, "comment": None}

    def remove(self, info_hash: str, delete_files: bool = False):
        with self._lock:
            h = self.torrents.pop(info_hash, None)
            self.info_cache.pop(info_hash, None)
            self._static_cached.discard(info_hash)
        if h:
            opt = lt.session.delete_files if delete_files else lt.session.delete_partfile
            self.session.remove_torrent(h, opt)
        rp = os.path.join(self._resume_dir, f"{info_hash}.resume")
        if os.path.exists(rp):
            os.remove(rp)
        self._save_torrents()

    def pause(self, info_hash: str):
        h = self.torrents.get(info_hash)
        if h and h.is_valid():
            # qBittorrent pattern: unset auto_managed THEN pause
            # Without this, libtorrent auto-resumes the torrent within 30s!
            h.unset_flags(lt.torrent_flags.auto_managed)
            h.pause()

    def resume(self, info_hash: str):
        h = self.torrents.get(info_hash)
        if h and h.is_valid():
            # qBittorrent pattern: set auto_managed THEN resume
            h.set_flags(lt.torrent_flags.auto_managed)
            h.resume()

    def pause_all(self):
        with self._lock:
            items = list(self.torrents.values())
        for h in items:
            if h.is_valid():
                h.unset_flags(lt.torrent_flags.auto_managed)
                h.pause()

    def resume_all(self):
        with self._lock:
            items = list(self.torrents.values())
        for h in items:
            if h.is_valid():
                h.set_flags(lt.torrent_flags.auto_managed)
                h.resume()

    def throttle(self, info_hash: str, down_limit: int, up_limit: int):
        h = self.torrents.get(info_hash)
        if h and h.is_valid():
            # libtorrent: 0 = unlimited, >0 = limit in bytes/sec
            h.set_download_limit(down_limit if down_limit > 0 else 0)
            h.set_upload_limit(up_limit if up_limit > 0 else 0)

    def update_settings(self, new_settings: dict) -> dict:
        self._settings.update(new_settings)
        pack = {}
        if "maxDownloadSpeed" in new_settings:
            v = new_settings["maxDownloadSpeed"]
            pack["download_rate_limit"] = v if v > 0 else 0
        if "maxUploadSpeed" in new_settings:
            v = new_settings["maxUploadSpeed"]
            pack["upload_rate_limit"] = v if v > 0 else 0
        if "maxConnections" in new_settings:
            pack["connections_limit"] = new_settings["maxConnections"]
        if "activeDownloads" in new_settings:
            pack["active_downloads"] = new_settings["activeDownloads"]
        if "activeSeeds" in new_settings:
            pack["active_seeds"] = new_settings["activeSeeds"]
        if "activeLimit" in new_settings:
            pack["active_limit"] = new_settings["activeLimit"]
        if pack:
            self.session.apply_settings(pack)
        self._save_settings()
        return self._settings

    # ─── Queries ───────────────────────────────────────────

    def get_all_light(self) -> list:
        result = []
        for tid in list(self.info_cache.keys()):
            info = dict(self.info_cache[tid])
            info.pop("files", None)
            info.pop("trackers", None)
            result.append(info)
        return result

    def get_full_info(self, info_hash: str) -> Optional[dict]:
        return self.info_cache.get(info_hash)

    def get_all_torrents(self) -> list:
        return list(self.info_cache.values())

    def get_session_stats(self) -> dict:
        # libtorrent 2.0+: session.status() is deprecated, aggregate from torrents
        dl_rate = 0
        ul_rate = 0
        peers = 0
        for info in self.info_cache.values():
            dl_rate += info.get("downloadSpeed", 0)
            ul_rate += info.get("uploadSpeed", 0)
            peers += info.get("numPeers", 0)
        return {
            "downloadRate": dl_rate,
            "uploadRate": ul_rate,
            "numPeers": peers,
            "numTorrents": len(self.torrents),
        }

    # ─── Persistence ───────────────────────────────────────

    def _save_torrents(self):
        try:
            data = []
            with self._lock:
                items = list(self.torrents.items())
            for tid, h in items:
                if not h.is_valid():
                    continue
                s = h.status()
                entry = {
                    "infoHash": tid,
                    "savePath": s.save_path,
                    "paused": s.paused,
                    "progress": round(s.total_wanted_done * 100 / s.total_wanted) if s.total_wanted > 0 else 0,
                }
                try:
                    entry["magnetURI"] = lt.make_magnet_uri(h)
                except Exception:
                    pass
                data.append(entry)
            with open(self._torrents_path, "w", encoding="utf-8") as f:
                json.dump(data, f, indent=2)
        except Exception as e:
            log(f"Save torrents error: {e}")

    def _save_all_resume(self):
        with self._lock:
            items = list(self.torrents.items())
        for tid, h in items:
            if h.is_valid() and h.has_metadata():
                try:
                    h.save_resume_data()
                except Exception:
                    pass

    def save(self):
        """Save torrents.json + resume data without stopping the engine."""
        self._save_all_resume()
        time.sleep(0.3)
        self._process_alerts()
        self._save_torrents()
        log("Manual save complete")

    def shutdown(self):
        self._running = False
        self._save_all_resume()
        time.sleep(0.5)
        self._process_alerts()
        self._save_torrents()
        log("Shutdown complete")


# ─── JSON-RPC stdin/stdout ─────────────────────────────────────

engine = SidecarEngine()

def log(msg: str):
    print(msg, file=sys.stderr, flush=True)

def respond(msg_id: str, result=None, error=None):
    resp = {"id": msg_id}
    if error:
        resp["error"] = str(error)
    else:
        resp["result"] = result
    sys.stdout.write(json.dumps(resp, ensure_ascii=False, default=str) + "\n")
    sys.stdout.flush()

def handle_message(msg: dict):
    msg_id = msg.get("id", "0")
    action = msg.get("action", "")
    args = msg.get("args") or {}

    try:
        if action == "init":
            engine.init(args["dataPath"])
            respond(msg_id, None)
        elif action == "loadSaved":
            engine.load_saved()
            respond(msg_id, None)
        elif action == "addTorrentFile":
            r = engine.add_torrent_file(args["filePath"], args.get("savePath"), args.get("start", True))
            respond(msg_id, r)
        elif action == "addMagnet":
            r = engine.add_magnet(args["magnetURI"], args.get("savePath"), args.get("start", True))
            respond(msg_id, r)
        elif action == "remove":
            engine.remove(args["infoHash"], args.get("deleteFiles", False))
            respond(msg_id, None)
        elif action == "pause":
            engine.pause(args["infoHash"])
            respond(msg_id, None)
        elif action == "resume":
            engine.resume(args["infoHash"])
            respond(msg_id, None)
        elif action == "pauseAll":
            engine.pause_all()
            respond(msg_id, None)
        elif action == "resumeAll":
            engine.resume_all()
            respond(msg_id, None)
        elif action == "throttle":
            engine.throttle(args["infoHash"], args.get("downLimit", -1), args.get("upLimit", -1))
            respond(msg_id, None)
        elif action == "updateSettings":
            r = engine.update_settings(args.get("settings", {}))
            respond(msg_id, r)
        elif action == "getAllLight":
            respond(msg_id, engine.get_all_light())
        elif action == "getFullInfo":
            respond(msg_id, engine.get_full_info(args["infoHash"]))
        elif action == "getAllTorrents":
            respond(msg_id, engine.get_all_torrents())
        elif action == "getSessionStats":
            respond(msg_id, engine.get_session_stats())
        elif action == "save":
            engine.save()
            respond(msg_id, None)
        elif action == "shutdown":
            engine.shutdown()
            respond(msg_id, None)
        else:
            respond(msg_id, error=f"Unknown action: {action}")
    except Exception as e:
        respond(msg_id, error=str(e))

def main():
    log("Sidecar starting...")
    for line in sys.stdin:
        line = line.strip()
        if not line:
            continue
        try:
            msg = json.loads(line)
            handle_message(msg)
            if msg.get("action") == "shutdown":
                break
        except json.JSONDecodeError as e:
            log(f"JSON parse error: {e}")
        except Exception as e:
            log(f"Error: {e}")
    log("Sidecar exiting")

if __name__ == "__main__":
    main()
