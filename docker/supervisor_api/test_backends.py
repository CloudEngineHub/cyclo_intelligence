import re
from pathlib import Path


APP_TEXT = (Path(__file__).resolve().parent / "app.py").read_text()


def test_green_vla_backend_is_registered_for_supervisor_api():
    assert re.search(r'"green_vla"\s*:\s*\{', APP_TEXT)
    assert '"service": "green_vla"' in APP_TEXT
    assert '"container": "green_vla_server"' in APP_TEXT
    assert 'robotis/green-vla-zenoh:0.1.0-' in APP_TEXT
