use crate::api;

#[unsafe(no_mangle)]
pub extern "C" fn alloc(len: u32) -> u32 {
    let mut buf = Vec::<u8>::with_capacity(len as usize);
    let ptr = buf.as_mut_ptr();
    std::mem::forget(buf);
    ptr as usize as u32
}

#[unsafe(no_mangle)]
pub unsafe extern "C" fn dealloc(ptr: u32, len: u32) {
    // SAFETY: ptr and len come from `alloc(len)`; JS frees each buffer once.
    drop(unsafe { Vec::from_raw_parts(ptr as usize as *mut u8, 0, len as usize) });
}

#[unsafe(no_mangle)]
pub unsafe extern "C" fn analyze(ptr: u32, len: u32) -> u64 {
    unsafe { call(ptr, len, api::analyze) }
}

#[unsafe(no_mangle)]
pub unsafe extern "C" fn simulate(ptr: u32, len: u32) -> u64 {
    unsafe { call(ptr, len, api::simulate) }
}

#[unsafe(no_mangle)]
pub unsafe extern "C" fn sensitivity(ptr: u32, len: u32) -> u64 {
    unsafe { call(ptr, len, api::sensitivity) }
}

unsafe fn call(ptr: u32, len: u32, f: fn(&[u8]) -> Vec<u8>) -> u64 {
    // SAFETY: JS wrote len bytes at ptr (from `alloc`) and does not touch them until `dealloc`.
    let input = unsafe { std::slice::from_raw_parts(ptr as usize as *const u8, len as usize) };
    let out = f(input).into_boxed_slice();
    let out_len = out.len() as u64;
    let out_ptr = Box::into_raw(out) as *mut u8 as usize as u64;
    (out_ptr << 32) | out_len
}

#[unsafe(no_mangle)]
pub unsafe extern "C" fn free_result(ptr: u32, len: u32) {
    // SAFETY: ptr and len are a result of `call`, freed once by JS.
    drop(unsafe {
        Box::from_raw(std::ptr::slice_from_raw_parts_mut(
            ptr as usize as *mut u8,
            len as usize,
        ))
    });
}
