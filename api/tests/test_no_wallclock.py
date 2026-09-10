'''The engine must never read the wall clock: that is silent look-ahead in a replay.'''
import re
from pathlib import Path

BANNED = re.compile(r'\b(datetime\.now|datetime\.utcnow|date\.today|time\.time)\s*\(')
APP = Path(__file__).resolve().parents[1] / 'app'
SCOPE = [APP / 'engine', APP / 'replay', APP / 'state.py']


def _files():
    for p in SCOPE:
        if p.is_file():
            yield p
        elif p.is_dir():
            yield from p.glob('*.py')


def test_engine_has_no_wallclock_access():
    offenders = [str(f) for f in _files() if BANNED.search(f.read_text())]
    assert not offenders, offenders
