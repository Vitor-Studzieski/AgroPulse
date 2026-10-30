import pytest

from app.geo import area_ha, centroid, is_closed, square


def test_square_area_is_close_to_expected():
    ring = square(-55.7, -12.5, 1.0)["coordinates"][0]
    assert area_ha(ring) == pytest.approx(100, rel=0.02)


def test_centroid_is_center_of_square():
    ring = square(-55.7, -12.5, 2.0)["coordinates"][0]
    lon, lat = centroid(ring)["coordinates"]
    assert lon == pytest.approx(-55.7, abs=1e-9)
    assert lat == pytest.approx(-12.5, abs=1e-9)


def test_is_closed():
    assert is_closed([[0, 0], [1, 0], [1, 1], [0, 0]])
    assert not is_closed([[0, 0], [1, 0], [1, 1], [0, 1]])
